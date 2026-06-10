import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { requireUserWorkspace } from '#src/webapp/data/session.server.ts';
import { CANONICAL_METRICS } from '#src/webapp/integrations/providers/core/catalog.ts';
import {
  CanonicalMetricKey,
  Granularity,
  type MetricKind,
  type MetricUnit,
} from '#src/webapp/integrations/providers/core/types.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { charts, metricPoints, sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

// All handlers are tenant-scoped via requireUserWorkspace() — they resolve the
// signed-in user's workspace and never trust client-supplied org/product ids.

const DEFAULT_MAX_POINTS = 500;

export interface SeriesPoint {
  bucketTs: number;
  value: number;
}

const combine = (values: number[], kind: MetricKind): number => {
  if (kind === 'sum') {
    return values.reduce((total, value) => total + value, 0);
  }
  if (kind === 'max') {
    return values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  }
  if (kind === 'last') {
    return values[values.length - 1];
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
};

// Aggregate adjacent buckets per the metric's kind when there are more points
// than the chart needs.
const downsample = (points: SeriesPoint[], kind: MetricKind, maxPoints: number): SeriesPoint[] => {
  if (points.length <= maxPoints) {
    return points;
  }
  const groupSize = Math.ceil(points.length / maxPoints);
  const out: SeriesPoint[] = [];
  for (let index = 0; index < points.length; index += groupSize) {
    const group = points.slice(index, index + groupSize);
    out.push({
      bucketTs: group[0].bucketTs,
      value: combine(
        group.map((point) => point.value),
        kind,
      ),
    });
  }
  return out;
};

const ConnectionSeriesQuery = z.object({
  connectionId: z.string().min(1),
  metricKeys: z.array(CanonicalMetricKey).min(1),
  granularity: Granularity.default('day'),
  start: z.number().int(),
  end: z.number().int(),
  maxPoints: z.number().int().positive().default(DEFAULT_MAX_POINTS),
});

export interface MetricSeries {
  metricKey: CanonicalMetricKey;
  label: string;
  unit: MetricUnit;
  points: SeriesPoint[];
}

const emptySeries = (metricKey: CanonicalMetricKey): MetricSeries => {
  const meta = CANONICAL_METRICS[metricKey];
  return { metricKey, label: meta.label, unit: meta.unit, points: [] };
};

// Multiple metrics for one connection in a single query — powers a consolidated
// per-domain chart (e.g. clicks + impressions on dual axes).
export const getConnectionSeries = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => ConnectionSeriesQuery.parse(data))
  .handler(async ({ data }): Promise<{ series: MetricSeries[] }> => {
    const { productId } = await requireUserWorkspace();
    const db = await getDb();

    // Ownership check: the connection must belong to the caller's product.
    const [owned] = await db
      .select({ productId: sourceConnections.productId })
      .from(sourceConnections)
      .where(eq(sourceConnections.id, data.connectionId))
      .limit(1);
    if (!owned || owned.productId !== productId) {
      return { series: data.metricKeys.map((metricKey) => emptySeries(metricKey)) };
    }

    const rows = await db
      .select({
        metricKey: metricPoints.metricKey,
        bucketTs: metricPoints.bucketTs,
        value: metricPoints.value,
      })
      .from(metricPoints)
      .where(
        and(
          eq(metricPoints.connectionId, data.connectionId),
          eq(metricPoints.granularity, data.granularity),
          eq(metricPoints.dimsHash, ''),
          inArray(metricPoints.metricKey, data.metricKeys),
          gte(metricPoints.bucketTs, data.start),
          lt(metricPoints.bucketTs, data.end),
        ),
      )
      .orderBy(asc(metricPoints.bucketTs));

    const byMetric = new Map<string, SeriesPoint[]>();
    for (const row of rows) {
      const list = byMetric.get(row.metricKey) ?? [];
      list.push({ bucketTs: row.bucketTs, value: row.value });
      byMetric.set(row.metricKey, list);
    }

    const series = data.metricKeys.map((metricKey): MetricSeries => {
      const meta = CANONICAL_METRICS[metricKey];
      return {
        metricKey,
        label: meta.label,
        unit: meta.unit,
        points: downsample(byMetric.get(metricKey) ?? [], meta.kind, data.maxPoints),
      };
    });

    return { series };
  });

export interface DashboardChart {
  id: string;
  connectionId: string;
  metricKey: CanonicalMetricKey;
  title: string;
  unit: MetricUnit;
  vizConfig: string;
}

export const getDashboardCharts = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardChart[]> => {
    const { dashboardId } = await requireUserWorkspace();
    const db = await getDb();
    const rows = await db
      .select()
      .from(charts)
      .where(eq(charts.dashboardId, dashboardId))
      .orderBy(asc(charts.sortOrder));

    return rows.flatMap((row) => {
      const metricKey = CanonicalMetricKey.safeParse(row.metricKey);
      if (!metricKey.success) {
        return [];
      }
      return [
        {
          id: row.id,
          connectionId: row.connectionId,
          metricKey: metricKey.data,
          title: row.title,
          unit: CANONICAL_METRICS[metricKey.data].unit,
          vizConfig: row.vizConfig,
        },
      ];
    });
  },
);
