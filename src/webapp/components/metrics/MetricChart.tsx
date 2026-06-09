import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricSeries } from '#src/webapp/data/metrics.ts';
import type { MetricUnit } from '#src/webapp/integrations/providers/core/types.ts';

const PERCENT = 100;
const CURRENCY_MINOR = 100;
const SERIES_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];

interface MetricChartProps {
  title: string;
  series: MetricSeries[];
}

const formatValue = (value: number, unit: MetricUnit): string => {
  if (unit === 'currency') {
    return `$${(value / CURRENCY_MINOR).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (unit === 'ratio') {
    return `${(value * PERCENT).toFixed(1)}%`;
  }
  if (unit === 'duration') {
    return `${Math.round(value)}s`;
  }
  return value.toLocaleString();
};

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Summary value for the header: total for additive metrics, average otherwise.
const summarize = (metric: MetricSeries): string => {
  const values = metric.points.map((point) => point.value);
  if (values.length === 0) {
    return '—';
  }
  const sum = values.reduce((total, value) => total + value, 0);
  const aggregate =
    metric.unit === 'count' || metric.unit === 'currency' ? sum : sum / values.length;
  return formatValue(aggregate, metric.unit);
};

// Merge per-metric point arrays into one row per bucket for Recharts.
const mergeRows = (series: MetricSeries[]): Array<Record<string, number>> => {
  const byTs = new Map<number, Record<string, number>>();
  for (const metric of series) {
    for (const point of metric.points) {
      const row = byTs.get(point.bucketTs) ?? { bucketTs: point.bucketTs };
      row[metric.metricKey] = point.value;
      byTs.set(point.bucketTs, row);
    }
  }
  return [...byTs.values()].sort((a, b) => a.bucketTs - b.bucketTs);
};

export function MetricChart({ title, series }: MetricChartProps) {
  const data = mergeRows(series);
  const unitByKey = new Map<string, MetricUnit>(
    series.map((metric) => [metric.metricKey, metric.unit]),
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="truncate text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</h3>
      {/* Summary row doubles as the legend — actual magnitudes without misleading axes. */}
      <div className="mt-1 mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((metric, index) => (
          <span
            key={metric.metricKey}
            className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
            />
            {metric.label}
            <span className="font-semibold text-zinc-800 tabular-nums dark:text-zinc-100">
              {summarize(metric)}
            </span>
          </span>
        ))}
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis
              dataKey="bucketTs"
              tickFormatter={formatDate}
              tick={{ fontSize: 12 }}
              stroke="currentColor"
              className="text-zinc-400"
            />
            {/* Hidden, independently-scaled axes: both trends fill the chart, no confusing numbers. */}
            <YAxis yAxisId="left" hide />
            <YAxis yAxisId="right" hide />
            <Tooltip
              formatter={(value: number, _name: string, item: { dataKey?: string | number }) =>
                formatValue(value, unitByKey.get(String(item.dataKey)) ?? 'count')
              }
              labelFormatter={(label: number) => formatDate(label)}
            />
            {series.map((metric, index) => (
              <Line
                key={metric.metricKey}
                yAxisId={index === 1 ? 'right' : 'left'}
                type="monotone"
                dataKey={metric.metricKey}
                name={metric.label}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
