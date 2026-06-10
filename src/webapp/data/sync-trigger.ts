import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { inArray } from 'drizzle-orm';
import { syncConnection } from '#src/webapp/data/sync-connection.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const SQS_BATCH_MAX = 10;
const DEDUPE_BUCKET_MS = 60_000;

let sqs: SQSClient | undefined;
const getSqs = (): SQSClient => {
  if (!sqs) {
    sqs = new SQSClient({});
  }
  return sqs;
};

export interface SyncRequestResult {
  connectionId: string;
  ok: boolean;
  queued?: boolean;
  rowsWritten?: number;
  error?: string;
}

// The ONE write path for "sync these connections now". When the ingestion queue
// exists (deployed), every sync request — scheduled, OAuth auto-sync, dashboard
// button — goes through the FIFO queue, where MessageGroupId=connectionId
// serializes work per connection (no cursor races by construction). Local dev
// has no queue, so it falls back to inline sync.
export const requestConnectionSync = async (
  connectionIds: string[],
): Promise<SyncRequestResult[]> => {
  if (connectionIds.length === 0) {
    return [];
  }
  const queueUrl = process.env.INGESTION_QUEUE_URL;
  if (queueUrl) {
    return enqueueSync(queueUrl, connectionIds);
  }
  return inlineSync(connectionIds);
};

const enqueueSync = async (
  queueUrl: string,
  connectionIds: string[],
): Promise<SyncRequestResult[]> => {
  const results: SyncRequestResult[] = [];
  // Dedup id is bucketed to the minute: a double-click can't enqueue twice, but
  // a deliberate retry a minute later goes through (FIFO dedupe window is 5 min).
  const bucket = Math.floor(Date.now() / DEDUPE_BUCKET_MS);
  for (let index = 0; index < connectionIds.length; index += SQS_BATCH_MAX) {
    const batch = connectionIds.slice(index, index + SQS_BATCH_MAX);
    // oxlint-disable-next-line no-await-in-loop
    const response = await getSqs().send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((connectionId, entryIndex) => ({
          Id: String(entryIndex),
          MessageBody: JSON.stringify({ connectionId }),
          MessageGroupId: connectionId,
          MessageDeduplicationId: `${connectionId}-${bucket}`,
        })),
      }),
    );
    const failedIds = new Set((response.Failed ?? []).map((entry) => entry.Id));
    for (const [entryIndex, connectionId] of batch.entries()) {
      const failed = failedIds.has(String(entryIndex));
      results.push(
        failed
          ? { connectionId, ok: false, error: 'failed to enqueue' }
          : { connectionId, ok: true, queued: true },
      );
    }
  }
  return results;
};

const inlineSync = async (connectionIds: string[]): Promise<SyncRequestResult[]> => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sourceConnections)
    .where(inArray(sourceConnections.id, connectionIds));
  const results: SyncRequestResult[] = [];
  for (const row of rows) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await syncConnection(db, row);
      results.push(
        outcome.kind === 'synced'
          ? { connectionId: row.id, ok: true, rowsWritten: outcome.rowsWritten }
          : { connectionId: row.id, ok: false, error: outcome.reason },
      );
    } catch (error) {
      results.push({ connectionId: row.id, ok: false, error: String(error) });
    }
  }
  return results;
};
