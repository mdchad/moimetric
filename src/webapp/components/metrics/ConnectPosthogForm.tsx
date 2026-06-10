import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { createConnection } from '#src/webapp/data/connections.ts';

const inputClass =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const labelClass = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

// Inline connect form: validates against the live PostHog API server-side
// (createConnection), creates default pageviews/visitors charts, and triggers
// the first sync. One connection per website — use the domain filter when
// several sites share a single PostHog project.
export function ConnectPosthogForm({ onConnected }: { onConnected: () => void }) {
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('https://us.posthog.com');
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hostFilter, setHostFilter] = useState('');

  const connect = useMutation({
    mutationFn: () =>
      createConnection({
        data: {
          provider: 'posthog',
          label,
          config: {
            host,
            projectId,
            ...(hostFilter.trim() ? { hostFilter: hostFilter.trim() } : {}),
          },
          secret: { apiKey },
          chartMetrics: ['pageviews', 'visitors'],
        },
      }),
    onSuccess: onConnected,
  });

  const canSubmit = label.trim() && host.trim() && projectId.trim() && apiKey.trim();

  return (
    <form
      className="mb-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !connect.isPending) {
          connect.mutate();
        }
      }}
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Connect PostHog
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ph-label">
            Name (chart title)
          </label>
          <input
            id="ph-label"
            className={inputClass}
            placeholder="mysite.com"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ph-host">
            PostHog host
          </label>
          <input
            id="ph-host"
            className={inputClass}
            placeholder="https://us.posthog.com"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ph-project">
            Project ID
          </label>
          <input
            id="ph-project"
            className={inputClass}
            placeholder="12345"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ph-key">
            Personal API key
          </label>
          <input
            id="ph-key"
            className={inputClass}
            type="password"
            placeholder="phx_…"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="ph-host-filter">
            Domain filter (optional — when one project tracks several websites)
          </label>
          <input
            id="ph-host-filter"
            className={inputClass}
            placeholder="mysite.com"
            value={hostFilter}
            onChange={(event) => setHostFilter(event.target.value)}
          />
        </div>
      </div>
      {connect.isError ? (
        <p className="mt-3 text-sm text-red-600">{String(connect.error)}</p>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit || connect.isPending}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {connect.isPending ? 'Validating…' : 'Connect'}
        </button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Needs a personal API key with query read access. Find your project ID in PostHog →
          Settings → Project.
        </p>
      </div>
    </form>
  );
}
