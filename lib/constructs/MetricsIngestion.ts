import { ArnFormat, Duration, Stack } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

const DISPATCH_RATE_HOURS = 1;
const DISPATCHER_TIMEOUT_SECONDS = 60;
const DISPATCHER_MEMORY_MB = 256;
const WORKER_TIMEOUT_SECONDS = 120;
const WORKER_MEMORY_MB = 512;
const WORKER_BATCH_SIZE = 5;
const WORKER_RESERVED_CONCURRENCY = 5;
// SQS visibility timeout must exceed the worker timeout; 6x gives redrive slack.
const QUEUE_VISIBILITY_SECONDS = WORKER_TIMEOUT_SECONDS * 6;
const DLQ_MAX_RECEIVE_COUNT = 3;
const DLQ_RETENTION_DAYS = 14;
const FORCE_DOCKER_BUNDLING_IN_CI = process.env.CI === 'true';

const BUNDLING = {
  minify: true,
  sourceMap: true,
  externalModules: ['@aws-sdk/*'],
  forceDockerBundling: FORCE_DOCKER_BUNDLING_IN_CI,
};

type MetricsIngestionProps = {
  appStage: string;
};

/**
 * Scheduled metric ingestion pipeline:
 *
 *   EventBridge rule (hourly) -> dispatcher Lambda (enumerate due connections)
 *     -> SQS FIFO queue (+ FIFO DLQ) -> worker Lambda (runIngestion per connection)
 *
 * The queue is FIFO with MessageGroupId = connectionId so all work for one
 * connection is serialized (no concurrent-sync cursor races), while different
 * connections process in parallel. The web Lambda sends to the same queue for
 * manual "Sync now" and OAuth auto-sync — one write path.
 */
export class MetricsIngestion extends Construct {
  /** FIFO ingestion queue; the web Lambda gets send rights for manual syncs. */
  readonly queue: Queue;

  constructor(scope: Construct, id: string, props: MetricsIngestionProps) {
    super(scope, id);

    const { appStage } = props;
    const stack = Stack.of(this);

    const tursoSecret = Secret.fromSecretNameV2(this, 'TursoSecret', `moimetric/${appStage}/turso`);
    // Per-connection provider credentials created at runtime by the webapp.
    const connectionSecretsArn = stack.formatArn({
      service: 'secretsmanager',
      resource: 'secret',
      resourceName: `moimetric/${appStage}/connections/*`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    const deadLetterQueue = new Queue(this, 'IngestionDlq', {
      fifo: true,
      enforceSSL: true,
      retentionPeriod: Duration.days(DLQ_RETENTION_DAYS),
    });

    this.queue = new Queue(this, 'IngestionQueue', {
      fifo: true,
      enforceSSL: true,
      // Explicit MessageDeduplicationId set by senders (connection + time bucket).
      contentBasedDeduplication: false,
      visibilityTimeout: Duration.seconds(QUEUE_VISIBILITY_SECONDS),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: DLQ_MAX_RECEIVE_COUNT },
    });

    const dispatcher = new NodejsFunction(this, 'Dispatcher', {
      entry: 'src/lambda/ingestion-dispatcher.ts',
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      timeout: Duration.seconds(DISPATCHER_TIMEOUT_SECONDS),
      memorySize: DISPATCHER_MEMORY_MB,
      environment: {
        TURSO_SECRET_ARN: tursoSecret.secretArn,
        INGESTION_QUEUE_URL: this.queue.queueUrl,
      },
      tracing: Tracing.ACTIVE,
      bundling: BUNDLING,
    });
    tursoSecret.grantRead(dispatcher);
    this.queue.grantSendMessages(dispatcher);

    new Rule(this, 'DispatchSchedule', {
      schedule: Schedule.rate(Duration.hours(DISPATCH_RATE_HOURS)),
      targets: [new LambdaFunction(dispatcher)],
    });

    const worker = new NodejsFunction(this, 'Worker', {
      entry: 'src/lambda/ingestion-worker.ts',
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      timeout: Duration.seconds(WORKER_TIMEOUT_SECONDS),
      memorySize: WORKER_MEMORY_MB,
      reservedConcurrentExecutions: WORKER_RESERVED_CONCURRENCY,
      environment: {
        TURSO_SECRET_ARN: tursoSecret.secretArn,
      },
      tracing: Tracing.ACTIVE,
      bundling: BUNDLING,
    });
    tursoSecret.grantRead(worker);
    worker.addToRolePolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
        resources: [connectionSecretsArn],
      }),
    );
    worker.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: WORKER_BATCH_SIZE,
        reportBatchItemFailures: true,
      }),
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'Lambdas use the AWS managed basic execution role; replacing it adds operational overhead for marginal gain (same posture as WebappServer).',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Worker reads per-connection provider secrets created at runtime under moimetric/<stage>/connections/* — a prefix wildcard is the narrowest possible grant. Secret name suffix wildcards come from grantRead on a name-referenced secret.',
        },
        {
          id: 'AwsSolutions-SQS3',
          reason: 'The DLQ is itself the dead-letter target; it does not need its own DLQ.',
        },
        {
          id: 'Serverless-LambdaDLQ',
          reason:
            'Worker failures redrive via the SQS queue to its DLQ; dispatcher is idempotent (FIFO dedup per tick) and re-runs on the next hourly tick.',
        },
        {
          id: 'Serverless-SQSRedrivePolicy',
          reason: 'The DLQ is the terminal dead-letter target; it has no further redrive.',
        },
        {
          id: 'Serverless-EventBusDLQ',
          reason:
            'A failed dispatcher tick is recovered by the next hourly tick (idempotent via FIFO per-tick dedup); a target DLQ would add a queue with nothing actionable in it.',
        },
        {
          id: 'Serverless-LambdaEventSourceMappingDestination',
          reason:
            'Failed items are handled via reportBatchItemFailures + the queue redrive policy to the FIFO DLQ; an additional on-failure destination would be redundant.',
        },
      ],
      true,
    );
  }
}
