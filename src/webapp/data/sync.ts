import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { requireUserWorkspace } from '#src/webapp/data/session.server.ts';
import { runIngestion } from '#src/webapp/data/ingest.ts';
import { getAdapter } from '#src/webapp/integrations/providers/core/registry.ts';
import { loadConnectionSecretRaw } from '#src/webapp/integrations/providers/core/secret.ts';
import { ProviderId } from '#src/webapp/integrations/providers/core/types.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const ONE_DAY_MS = 86_400_000;
const MAX_BACKFILL_DAYS = 400;
const DEFAULT_BACKFILL_DAYS = 90;

interface SyncResult {
  connectionId: string;
  ok: boolean;
  rowsWritten?: number;
  error?: string;
}

// On-demand ingestion for all of a product's active connections. Used by the
// dashboard "Sync now" button; the same runIngestion path the scheduled worker
// will use later.
export const syncProduct = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ synced: number; results: SyncResult[] }> => {
    const { productId } = await requireUserWorkspace();
    const db = await getDb();
    const connections = await db
      .select()
      .from(sourceConnections)
      .where(eq(sourceConnections.productId, productId));

    const end = Date.now();
    const results: SyncResult[] = [];

    for (const connection of connections) {
      if (connection.status === 'disabled' || !connection.credSecretArn) {
        continue;
      }
      const provider = ProviderId.safeParse(connection.provider);
      if (!provider.success) {
        continue;
      }
      try {
        const adapter = getAdapter(provider.data);
        // oxlint-disable-next-line no-await-in-loop
        const secret = await loadConnectionSecretRaw(connection.credSecretArn);
        const config = JSON.parse(connection.providerConfig);
        const metricKeys = adapter.catalog().map((metric) => metric.key);
        const lagMs = (adapter.capabilities().dataLagDays ?? 0) * ONE_DAY_MS;
        const cursor = connection.incrementalCursor ? Number(connection.incrementalCursor) : 0;
        const start = cursor
          ? Math.max(cursor - lagMs, end - MAX_BACKFILL_DAYS * ONE_DAY_MS)
          : end - DEFAULT_BACKFILL_DAYS * ONE_DAY_MS - lagMs;

        // oxlint-disable-next-line no-await-in-loop
        const result = await runIngestion(db, {
          connectionId: connection.id,
          adapter,
          config,
          secret,
          metricKeys,
          granularity: 'day',
          start,
          end,
          kind: cursor ? 'incremental' : 'backfill',
        });
        results.push({ connectionId: connection.id, ok: true, rowsWritten: result.rowsWritten });
      } catch (error) {
        results.push({ connectionId: connection.id, ok: false, error: String(error) });
      }
    }

    return { synced: results.length, results };
  },
);
