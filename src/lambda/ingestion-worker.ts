import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { syncConnection } from '#src/webapp/data/sync-connection.ts';
import { isRetryable, ProviderError } from '#src/webapp/integrations/providers/core/errors.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const MessageBody = z.object({ connectionId: z.string().min(1) });

// SQS FIFO consumer: one connection per message, serialized per connection by
// MessageGroupId. Retry routing uses the ProviderError taxonomy:
//   transient / rate_limited  -> report the item failed (SQS redrives, then DLQ)
//   auth / permanent          -> mark the connection 'error' and ack (no retry;
//                                the dispatcher stops enqueueing it until the
//                                user reconnects)
//   anything else (a bug)     -> report failed (redrive surfaces it in the DLQ)
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const db = await getDb();
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const parsed = MessageBody.safeParse(JSON.parse(record.body));
    if (!parsed.success) {
      console.error('ingestion-worker: malformed message dropped', record.body);
      continue;
    }
    const { connectionId } = parsed.data;

    // oxlint-disable-next-line no-await-in-loop
    const rows = await db
      .select()
      .from(sourceConnections)
      .where(eq(sourceConnections.id, connectionId))
      .limit(1);
    const connection = rows[0];
    if (!connection || connection.status === 'disabled' || connection.status === 'error') {
      continue; // deleted/disabled since enqueue — ack and move on
    }

    try {
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await syncConnection(db, connection);
      console.log(JSON.stringify({ msg: 'ingestion-worker', connectionId, outcome }));
    } catch (error) {
      if (error instanceof ProviderError && !isRetryable(error)) {
        // Dead credential / permanent failure: runIngestion already recorded the
        // failed sync_run; flip the connection so the scheduler stops retrying.
        console.error(
          JSON.stringify({
            msg: 'ingestion-worker permanent failure',
            connectionId,
            kind: error.kind,
            error: error.message,
          }),
        );
        // oxlint-disable-next-line no-await-in-loop
        await db
          .update(sourceConnections)
          .set({ status: 'error' })
          .where(eq(sourceConnections.id, connectionId));
        continue;
      }
      console.error(
        JSON.stringify({
          msg: 'ingestion-worker retryable failure',
          connectionId,
          error: String(error),
        }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
