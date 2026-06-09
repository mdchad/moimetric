import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { CANONICAL_METRICS } from '#src/webapp/integrations/providers/core/catalog.ts';
import {
  CanonicalMetricKey,
  Granularity,
  type MetricKind,
  type MetricUnit,
} from '#src/webapp/integrations/providers/core/types.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { charts, metricPoints } from '#src/webapp/integrations/turso/schema.ts';

// NOTE: tenant scoping (org membership) is intentionally deferred — the app is
// gated behind the seeded dev org until better-auth lands. Once it does, these
// handlers must verify membership before querying.

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

const MetricSeriesQuery = z.object({
  connectionId: z.string().min(1),
  metricKey: CanonicalMetricKey,
  granularity: Granularity.default('day'),
  start: z.number().int(),
  end: z.number().int(),
  maxPoints: z.number().int().positive().default(DEFAULT_MAX_POINTS),
});

export interface MetricSeriesResult {
  unit: MetricUnit;
  label: string;
  points: SeriesPoint[];
}

export const getMetricSeries = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => MetricSeriesQuery.parse(data))
  .handler(async ({ data }): Promise<MetricSeriesResult> => {
    const db = await getDb();
    const rows = await db
      .select({ bucketTs: metricPoints.bucketTs, value: metricPoints.value })
      .from(metricPoints)
      .where(
        and(
          eq(metricPoints.connectionId, data.connectionId),
          eq(metricPoints.metricKey, data.metricKey),
          eq(metricPoints.granularity, data.granularity),
          eq(metricPoints.dimsHash, ''),
          gte(metricPoints.bucketTs, data.start),
          lt(metricPoints.bucketTs, data.end),
        ),
      )
      .orderBy(asc(metricPoints.bucketTs));

    const meta = CANONICAL_METRICS[data.metricKey];
    return {
      unit: meta.unit,
      label: meta.label,
      points: downsample(rows, meta.kind, data.maxPoints),
    };
  });

const DashboardChartsQuery = z.object({ dashboardId: z.string().min(1) });

export interface DashboardChart {
  id: string;
  connectionId: string;
  metricKey: CanonicalMetricKey;
  title: string;
  unit: MetricUnit;
  vizConfig: string;
}

export const getDashboardCharts = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => DashboardChartsQuery.parse(data))
  .handler(async ({ data }): Promise<DashboardChart[]> => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(charts)
      .where(eq(charts.dashboardId, data.dashboardId))
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
  });
