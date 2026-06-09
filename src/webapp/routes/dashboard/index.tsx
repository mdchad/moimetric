import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { MetricChart } from '#src/webapp/components/metrics/MetricChart.tsx';
import { getConnectionSeries, getDashboardCharts } from '#src/webapp/data/metrics.ts';
import { syncProduct } from '#src/webapp/data/sync.ts';
import type { CanonicalMetricKey } from '#src/webapp/integrations/providers/core/types.ts';
import { DEV_DASHBOARD_ID, DEV_PRODUCT_ID } from '#src/webapp/integrations/turso/dev-ids.ts';

const ONE_DAY_MS = 86_400_000;
const POLL_MS = 300_000; // 5 min — aligns with ingestion cadence
const RANGE_OPTIONS = [7, 30, 90] as const;
const DEFAULT_WINDOW_DAYS = 90;

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
});

// One panel per connection (domain), showing all its metrics together.
interface ChartGroup {
  connectionId: string;
  title: string;
  metricKeys: CanonicalMetricKey[];
}

function ChartCard({ group, windowDays }: { group: ChartGroup; windowDays: number }) {
  const { data } = useQuery({
    queryKey: ['connection-series', group.connectionId, group.metricKeys.join(','), windowDays],
    queryFn: () => {
      const end = Date.now();
      return getConnectionSeries({
        data: {
          connectionId: group.connectionId,
          metricKeys: group.metricKeys,
          granularity: 'day',
          start: end - windowDays * ONE_DAY_MS,
          end,
        },
      });
    },
    refetchInterval: POLL_MS,
  });

  return <MetricChart title={group.title} series={data?.series ?? []} />;
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_WINDOW_DAYS);

  const { data: dashboardCharts } = useQuery({
    queryKey: ['dashboard-charts', DEV_DASHBOARD_ID],
    queryFn: () => getDashboardCharts({ data: { dashboardId: DEV_DASHBOARD_ID } }),
  });

  const sync = useMutation({
    mutationFn: () => syncProduct({ data: { productId: DEV_PRODUCT_ID } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-charts'] });
      queryClient.invalidateQueries({ queryKey: ['connection-series'] });
    },
  });

  // Collapse the per-metric chart rows into one group per connection.
  const groups = new Map<string, ChartGroup>();
  for (const chart of dashboardCharts ?? []) {
    const group = groups.get(chart.connectionId) ?? {
      connectionId: chart.connectionId,
      title: chart.title.split(' · ')[0],
      metricKeys: [],
    };
    if (!group.metricKeys.includes(chart.metricKey)) {
      group.metricKeys.push(chart.metricKey);
    }
    groups.set(chart.connectionId, group);
  }
  const chartGroups = [...groups.values()];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Dashboard</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Demo App · last {windowDays} days</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setWindowDays(days)}
                className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                  windowDays === days
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
          <a
            href="/api/connect/google/start"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Connect Google Search Console
          </a>
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </header>

      {sync.isError ? (
        <p className="mb-4 text-sm text-red-600">Sync failed: {String(sync.error)}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {chartGroups.map((group) => (
          <ChartCard key={group.connectionId} group={group} windowDays={windowDays} />
        ))}
      </div>

      {chartGroups.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No charts yet. Click “Connect Google Search Console”, then “Sync now”.
        </p>
      ) : null}
    </div>
  );
}
