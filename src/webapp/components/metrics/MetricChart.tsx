import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '#src/webapp/data/metrics.ts';
import type { MetricUnit } from '#src/webapp/integrations/providers/core/types.ts';

const PERCENT = 100;
const CURRENCY_MINOR = 100;

interface MetricChartProps {
  title: string;
  unit: MetricUnit;
  points: SeriesPoint[];
}

const formatValue = (value: number, unit: MetricUnit): string => {
  if (unit === 'currency') {
    return `$${(value / CURRENCY_MINOR).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function MetricChart({ title, unit, points }: MetricChartProps) {
  const gradientId = `grad-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis
              dataKey="bucketTs"
              tickFormatter={formatDate}
              tick={{ fontSize: 12 }}
              stroke="currentColor"
              className="text-zinc-400"
            />
            <YAxis
              width={56}
              tickFormatter={(value: number) => formatValue(value, unit)}
              tick={{ fontSize: 12 }}
              stroke="currentColor"
              className="text-zinc-400"
            />
            <Tooltip
              formatter={(value: number) => formatValue(value, unit)}
              labelFormatter={(label: number) => formatDate(label)}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#6366f1"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
