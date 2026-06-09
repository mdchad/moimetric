import path from 'node:path';
import { Duration, Tags } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { TIMEOUT_IN_SECONDS } from './type.ts';

type WebappServerProps = {
  appStage: string;
};
export class WebappServer extends Construct {
  readonly webappServer: Function;

  constructor(scope: Construct, id: string, props: WebappServerProps) {
    super(scope, id);

    const { appStage } = props;

    // Turso (libSQL) credentials live in a per-stage Secrets Manager secret
    // created out-of-band (see README): moimetric/<stage>/turso => { url, authToken }.
    const tursoSecret = Secret.fromSecretNameV2(this, 'TursoSecret', `moimetric/${appStage}/turso`);

    this.webappServer = new Function(this, 'WebappServer', {
      code: Code.fromAsset(
        path.join(path.dirname(new URL(import.meta.url).pathname), '../../.output/server'),
      ),
      reservedConcurrentExecutions: 100,
      // functionName: PhysicalName.GENERATE_IF_NEEDED,
      handler: 'index.handler',
      memorySize: 2048,
      runtime: Runtime.NODEJS_24_X,
      // oxlint-disable-next-line no-magic-numbers
      timeout: Duration.seconds(TIMEOUT_IN_SECONDS),
      // timeout: Duration.seconds(60),
      environment: {
        TURSO_SECRET_ARN: tursoSecret.secretArn,
      },
      tracing: Tracing.ACTIVE,
    });

    tursoSecret.grantRead(this.webappServer);
    Tags.of(this.webappServer).add('IsWebAppServer', 'true');

    this.webappServer.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        effect: Effect.ALLOW,
        resources: ['*'],
      }),
    );

    this.webappServer.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudwatch:GetMetricStatistics', 'cloudwatch:ListMetrics'],
        effect: Effect.ALLOW,
        resources: ['*'],
      }),
    );

    NagSuppressions.addResourceSuppressions(
      this.webappServer,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Bedrock InvokeModel requires *; model ARNs are dynamic. CloudWatch ListMetrics/GetMetricStatistics require * per AWS API design.',
        },
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'Lambda uses AWS managed policies; replacing with custom policies adds operational overhead for marginal security gain.',
        },
        {
          id: 'Serverless-LambdaDLQ',
          reason: 'DLQ adds cost and complexity; application has retry and error handling.',
        },
      ],
      true,
    );
  }
}
