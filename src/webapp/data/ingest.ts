import { eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { MetricSourceAdapter } from '#src/webapp/integrations/providers/core/adapter.ts';
import type {
  CanonicalMetricKey,
  Granularity,
  MetricPoint,
} from '#src/webapp/integrations/providers/core/types.ts';
import type { Database } from '#src/webapp/integrations/turso/db.ts';
import {
  metricPoints,
  sourceConnections,
  syncRuns,
} from '#src/webapp/integrations/turso/schema.ts';

const UPSERT_CHUNK = 500;

// Deterministic key for a point's dimensions. Empty for totals (v1 charts).
const dimsKey = (dims?: Record<string, string>): string => {
  if (!dims) {
    return '';
  }
  const keys = Object.keys(dims).sort();
  if (keys.length === 0) {
    return '';
  }
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, dims[key]])));
};

// Idempotent upsert keyed by the composite PK. Re-ingesting the same window
// never creates duplicate rows; only changed values are corrected.
export const upsertMetricPoints = async (
  db: Database,
  connectionId: string,
  points: MetricPoint[],
): Promise<number> => {
  if (points.length === 0) {
    return 0;
  }
  const updatedAt = Date.now();
  const rows = points.map((point) => {
    const dims = dimsKey(point.dims);
    return {
      connectionId,
      metricKey: point.metricKey,
      granularity: point.granularity,
      bucketTs: point.bucketTs,
      value: point.value,
      dims,
      dimsHash: dims,
      updatedAt,
    };
  });

  let written = 0;
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK);
    // oxlint-disable-next-line no-await-in-loop
    await db
      .insert(metricPoints)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          metricPoints.connectionId,
          metricPoints.metricKey,
          metricPoints.granularity,
          metricPoints.bucketTs,
          metricPoints.dimsHash,
        ],
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
      });
    written += chunk.length;
  }
  return written;
};

export interface RunIngestionArgs {
  connectionId: string;
  adapter: MetricSourceAdapter;
  config: unknown;
  secret: unknown;
  metricKeys: CanonicalMetricKey[];
  granularity: Granularity;
  start: number;
  end: number;
  kind: 'backfill' | 'incremental';
}

// Runs one ingestion pass for a connection: fetch each metric (paging via the
// adapter's opaque cursor), upsert points, then record a sync_run and advance
// the connection's incremental cursor. Reused by the local script and (later)
// the SQS ingestion worker Lambda.
export const runIngestion = async (
  db: Database,
  args: RunIngestionArgs,
): Promise<{ rowsWritten: number; cursorAfter: string | null }> => {
  const runId = ulid();
  await db
    .insert(syncRuns)
    .values({ id: runId, connectionId: args.connectionId, kind: args.kind, status: 'running' });

  try {
    let rowsWritten = 0;
    let maxWatermark = 0;

    for (const metricKey of args.metricKeys) {
      let cursor: string | null = null;
      do {
        // oxlint-disable-next-line no-await-in-loop
        const page = await args.adapter.fetchTimeSeries({
          config: args.config,
          secret: args.secret,
          metricKey,
          granularity: args.granularity,
          start: args.start,
          end: args.end,
          cursor,
        });
        // oxlint-disable-next-line no-await-in-loop
        rowsWritten += await upsertMetricPoints(db, args.connectionId, page.points);
        if (page.watermark) {
          maxWatermark = Math.max(maxWatermark, page.watermark);
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    const cursorAfter = maxWatermark ? String(maxWatermark) : null;
    const finishedAt = Date.now();
    await db
      .update(syncRuns)
      .set({ status: 'success', finishedAt, rowsWritten, cursorAfter })
      .where(eq(syncRuns.id, runId));
    await db
      .update(sourceConnections)
      .set({ status: 'active', lastSyncedAt: finishedAt, incrementalCursor: cursorAfter })
      .where(eq(sourceConnections.id, args.connectionId));

    return { rowsWritten, cursorAfter };
  } catch (error) {
    await db
      .update(syncRuns)
      .set({ status: 'error', finishedAt: Date.now(), error: String(error) })
      .where(eq(syncRuns.id, runId));
    throw error;
  }
};
