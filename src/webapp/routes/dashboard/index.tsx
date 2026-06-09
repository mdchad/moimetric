import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { MetricChart } from '#src/webapp/components/metrics/MetricChart.tsx';
import {
  type DashboardChart,
  getDashboardCharts,
  getMetricSeries,
} from '#src/webapp/data/metrics.ts';
import { DEV_DASHBOARD_ID } from '#src/webapp/integrations/turso/dev-ids.ts';

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
  const { data: dashboardCharts } = useQuery({
    queryKey: ['dashboard-charts', DEV_DASHBOARD_ID],
    queryFn: () => getDashboardCharts({ data: { dashboardId: DEV_DASHBOARD_ID } }),
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Demo App · last {WINDOW_DAYS} days
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {(dashboardCharts ?? []).map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </div>
      {dashboardCharts?.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No charts yet. Run `vp run metrics:ingest` to populate data.
        </p>
      ) : null}
    </div>
  );
}
