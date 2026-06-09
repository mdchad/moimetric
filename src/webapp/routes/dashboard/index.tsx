import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { MetricChart } from '#src/webapp/components/metrics/MetricChart.tsx';
import {
  type DashboardChart,
  getDashboardCharts,
  getMetricSeries,
} from '#src/webapp/data/metrics.ts';
import { syncProduct } from '#src/webapp/data/sync.ts';
import { DEV_DASHBOARD_ID, DEV_PRODUCT_ID } from '#src/webapp/integrations/turso/dev-ids.ts';

const ONE_DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const POLL_MS = 300_000; // 5 min — aligns with ingestion cadence

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
});

function ChartCard({ chart }: { chart: DashboardChart }) {
  const { data } = useQuery({
    queryKey: ['metric-series', chart.connectionId, chart.metricKey],
    queryFn: () => {
      const end = Date.now();
      return getMetricSeries({
        data: {
          connectionId: chart.connectionId,
          metricKey: chart.metricKey,
          granularity: 'day',
          start: end - WINDOW_DAYS * ONE_DAY_MS,
          end,
        },
      });
    },
    refetchInterval: POLL_MS,
  });

  return (
    <MetricChart title={chart.title} unit={data?.unit ?? chart.unit} points={data?.points ?? []} />
  );
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: dashboardCharts } = useQuery({
    queryKey: ['dashboard-charts', DEV_DASHBOARD_ID],
    queryFn: () => getDashboardCharts({ data: { dashboardId: DEV_DASHBOARD_ID } }),
  });

  const sync = useMutation({
    mutationFn: () => syncProduct({ data: { productId: DEV_PRODUCT_ID } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-charts'] });
      queryClient.invalidateQueries({ queryKey: ['metric-series'] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Demo App · last {WINDOW_DAYS} days
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        {(dashboardCharts ?? []).map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </div>

      {dashboardCharts?.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No charts yet. Click “Connect Google Search Console”, then “Sync now”.
        </p>
      ) : null}
    </div>
  );
}
