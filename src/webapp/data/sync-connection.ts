import { runIngestion } from '#src/webapp/data/ingest.ts';
import {
  getAdapter,
  registeredProviders,
} from '#src/webapp/integrations/providers/core/registry.ts';
import { loadConnectionSecretRaw } from '#src/webapp/integrations/providers/core/secret.ts';
import { ProviderId } from '#src/webapp/integrations/providers/core/types.ts';
import type { Database } from '#src/webapp/integrations/turso/db.ts';
import type { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const ONE_DAY_MS = 86_400_000;
const MAX_BACKFILL_DAYS = 400;
const DEFAULT_BACKFILL_DAYS = 90;

export type SourceConnectionRow = typeof sourceConnections.$inferSelect;

export type ConnectionSyncOutcome =
  | { kind: 'synced'; rowsWritten: number }
  | { kind: 'skipped'; reason: string };

// Single source of truth for syncing one connection. Shared by the on-demand
// server function, the OAuth auto-sync fallback, and the SQS ingestion worker —
// one code path, one window calculation. Throws ProviderError on failure so
// callers can classify retryability (isRetryable) themselves.
export const syncConnection = async (
  db: Database,
  connection: SourceConnectionRow,
): Promise<ConnectionSyncOutcome> => {
  if (!connection.credSecretArn) {
    return { kind: 'skipped', reason: 'no credentials' };
  }
  const provider = ProviderId.safeParse(connection.provider);
  // Unknown or not-yet-registered providers (enum lists more than the registry
  // implements) are skipped, never thrown — one bad row must not poison a sync loop.
  if (!provider.success || !registeredProviders().includes(provider.data)) {
    return { kind: 'skipped', reason: `provider ${connection.provider} not registered` };
  }

  const adapter = getAdapter(provider.data);
  const secret = await loadConnectionSecretRaw(connection.credSecretArn);

  let config: unknown;
  try {
    config = JSON.parse(connection.providerConfig);
  } catch {
    return { kind: 'skipped', reason: 'invalid providerConfig JSON' };
  }

  const end = Date.now();
  const metricKeys = adapter.catalog().map((metric) => metric.key);
  const lagMs = (adapter.capabilities().dataLagDays ?? 0) * ONE_DAY_MS;
  const cursor = connection.incrementalCursor ? Number(connection.incrementalCursor) : 0;
  const start = cursor
    ? Math.max(cursor - lagMs, end - MAX_BACKFILL_DAYS * ONE_DAY_MS)
    : end - DEFAULT_BACKFILL_DAYS * ONE_DAY_MS - lagMs;

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
  return { kind: 'synced', rowsWritten: result.rowsWritten };
};

// Cadence helper for the dispatcher: how long after lastSyncedAt a connection
// becomes due again. Slightly under the nominal interval so an hourly tick
// catches "almost due" connections instead of drifting a full extra tick.
const HOURLY_DUE_MS = 55 * 60_000;
const DAILY_DUE_MS = 23 * 3_600_000;

export const isConnectionDue = (connection: SourceConnectionRow, now: number): boolean => {
  const provider = ProviderId.safeParse(connection.provider);
  if (!provider.success || !registeredProviders().includes(provider.data)) {
    return false;
  }
  if (!connection.lastSyncedAt) {
    return true; // never synced
  }
  const cadence = getAdapter(provider.data).capabilities().recommendedCadence;
  const dueMs = cadence === 'hourly' ? HOURLY_DUE_MS : DAILY_DUE_MS;
  return now - connection.lastSyncedAt >= dueMs;
};
