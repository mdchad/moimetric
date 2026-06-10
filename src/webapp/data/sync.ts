import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { requireUserWorkspace } from '#src/webapp/data/session.server.ts';
import { requestConnectionSync, type SyncRequestResult } from '#src/webapp/data/sync-trigger.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

// On-demand ingestion for all of a product's active connections (dashboard
// "Sync now" button). Deployed, this enqueues to the FIFO ingestion queue —
// the same single write path the scheduler uses — so a manual sync can never
// race a scheduled one. Local dev (no queue) syncs inline.
export const syncProduct = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ synced: number; results: SyncRequestResult[] }> => {
    const { productId } = await requireUserWorkspace();
    const db = await getDb();
    const connections = await db
      .select({ id: sourceConnections.id, status: sourceConnections.status })
      .from(sourceConnections)
      .where(eq(sourceConnections.productId, productId));

    const syncable = connections
      .filter((connection) => connection.status !== 'disabled')
      .map((connection) => connection.id);
    const results = await requestConnectionSync(syncable);
    return { synced: results.length, results };
  },
);
