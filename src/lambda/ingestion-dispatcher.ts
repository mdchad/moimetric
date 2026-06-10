import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { inArray } from 'drizzle-orm';
import { isConnectionDue } from '#src/webapp/data/sync-connection.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const SQS_BATCH_MAX = 10;

const sqs = new SQSClient({});

// Hourly EventBridge tick. Enumerates connections that are due per their
// adapter's recommendedCadence and enqueues one FIFO message per connection
// (MessageGroupId=connectionId serializes each connection's work). Does NO
// vendor I/O — planning only, so a vendor outage can never stall the tick.
// 'error' connections are excluded: a dead credential is not retried forever;
// reconnecting flips the row back to 'active'.
export const handler = async (): Promise<{ enqueued: number }> => {
  const queueUrl = process.env.INGESTION_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('INGESTION_QUEUE_URL is not set');
  }

  const db = await getDb();
  const candidates = await db
    .select()
    .from(sourceConnections)
    .where(inArray(sourceConnections.status, ['pending', 'active']));

  const now = Date.now();
  const due = candidates.filter(
    (connection) => connection.credSecretArn && isConnectionDue(connection, now),
  );

  // Dedup id bucketed to the tick hour: a retried/overlapping tick cannot
  // double-enqueue the same connection.
  const hourBucket = Math.floor(now / 3_600_000);
  let enqueued = 0;
  for (let index = 0; index < due.length; index += SQS_BATCH_MAX) {
    const batch = due.slice(index, index + SQS_BATCH_MAX);
    // oxlint-disable-next-line no-await-in-loop
    const response = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((connection, entryIndex) => ({
          Id: String(entryIndex),
          MessageBody: JSON.stringify({ connectionId: connection.id }),
          MessageGroupId: connection.id,
          MessageDeduplicationId: `${connection.id}-${hourBucket}`,
        })),
      }),
    );
    enqueued += batch.length - (response.Failed?.length ?? 0);
    for (const failure of response.Failed ?? []) {
      console.error('ingestion-dispatcher: failed to enqueue', JSON.stringify(failure));
    }
  }

  console.log(
    JSON.stringify({
      msg: 'ingestion-dispatcher tick',
      candidates: candidates.length,
      due: due.length,
      enqueued,
    }),
  );
  return { enqueued };
};
