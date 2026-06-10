// Architecture map for the /architecture page. Nodes are the real modules of
// the system, edges are actual call/data relationships, and each node carries
// its source files (embedded at build time via Vite `?raw` imports) plus the
// explanation shown in the main panel.

export const NODE_W = 200;
export const NODE_H = 64;
export const CANVAS_W = 980;
export const CANVAS_H = 660;

export type NodeKind = 'web' | 'domain' | 'aws' | 'data' | 'external';

export interface ArchFile {
  path: string;
  load: () => Promise<string>;
}

export interface ArchNode {
  id: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  x: number;
  y: number;
  summary: string;
  invariants?: string[];
  files: ArchFile[];
}

export interface ArchEdge {
  from: string;
  to: string;
  label: string;
}

const raw =
  (loader: () => Promise<{ default: string }>): (() => Promise<string>) =>
  () =>
    loader().then((module) => module.default);

export const NODES: ArchNode[] = [
  {
    id: 'dashboard-ui',
    title: 'Dashboard UI',
    subtitle: 'React (TanStack Router)',
    kind: 'web',
    x: 20,
    y: 20,
    summary:
      'The web client: one consolidated chart per connection (domain), a range picker, and the connect flows. It polls every 5 minutes via TanStack Query and calls the server functions as typed RPC. It contains no business logic — it renders what the read path returns and triggers mutations.',
    files: [
      {
        path: 'src/webapp/routes/dashboard/index.tsx',
        load: raw(() => import('#src/webapp/routes/dashboard/index.tsx?raw')),
      },
      {
        path: 'src/webapp/components/metrics/MetricChart.tsx',
        load: raw(() => import('#src/webapp/components/metrics/MetricChart.tsx?raw')),
      },
      {
        path: 'src/webapp/components/metrics/ConnectPosthogForm.tsx',
        load: raw(() => import('#src/webapp/components/metrics/ConnectPosthogForm.tsx?raw')),
      },
    ],
  },
  {
    id: 'oauth-flow',
    title: 'GSC OAuth connect',
    subtitle: 'server routes (api.connect.*)',
    kind: 'web',
    x: 250,
    y: 20,
    summary:
      'Plain HTTP server routes (the Next.js-style kind, not server functions) implementing the Google OAuth dance: start sets a CSRF state cookie, the callback exchanges the code, stores the refresh token in Secrets Manager, inserts one connection per GSC property with default charts, then triggers the first sync. These routes are a public, stable HTTP contract — the same mechanism the future Expo API will use.',
    invariants: ['Callback never trusts client-supplied ids — workspace comes from the session.'],
    files: [
      {
        path: 'src/webapp/routes/api.connect.google.callback.ts',
        load: raw(() => import('#src/webapp/routes/api.connect.google.callback.ts?raw')),
      },
      {
        path: 'src/webapp/routes/api.connect.google.start.ts',
        load: raw(() => import('#src/webapp/routes/api.connect.google.start.ts?raw')),
      },
      {
        path: 'src/webapp/data/gsc-connect.ts',
        load: raw(() => import('#src/webapp/data/gsc-connect.ts?raw')),
      },
    ],
  },
  {
    id: 'scheduler',
    title: 'EventBridge tick',
    subtitle: 'hourly rule (CDK)',
    kind: 'aws',
    x: 740,
    y: 20,
    summary:
      'An hourly EventBridge rule fires the dispatcher. The whole ingestion pipeline (rule, both Lambdas, FIFO queue + DLQ, IAM grants, cdk-nag suppressions) is one CDK construct, MetricsIngestion, wired into the Webapp construct. Handlers are bundled per-entry with NodejsFunction + esbuild, separate from the Nitro web build.',
    files: [
      {
        path: 'lib/constructs/MetricsIngestion.ts',
        load: raw(() => import('../../../../lib/constructs/MetricsIngestion.ts?raw')),
      },
      {
        path: 'lib/constructs/Webapp.ts',
        load: raw(() => import('../../../../lib/constructs/Webapp.ts?raw')),
      },
    ],
  },
  {
    id: 'server-fns',
    title: 'Server functions',
    subtitle: 'data/* (createServerFn)',
    kind: 'web',
    x: 20,
    y: 150,
    summary:
      'The web app’s read/mutate layer: getConnectionSeries / getDashboardCharts (charts), syncProduct (Sync now), createConnection / listConnections (connect). These are TanStack RPC — framework-internal transport for the web app only; the Expo app will get its own door (tRPC/REST server route) over the same domain functions. Target discipline: handlers contain no logic — parse input, resolve the workspace, call a plain function.',
    invariants: [
      'Every handler is tenant-scoped via requireUserWorkspace() — client-supplied product ids are never trusted.',
      'createServerFn endpoints are NOT a public API contract (mobile must not call them).',
    ],
    files: [
      {
        path: 'src/webapp/data/metrics.ts',
        load: raw(() => import('#src/webapp/data/metrics.ts?raw')),
      },
      { path: 'src/webapp/data/sync.ts', load: raw(() => import('#src/webapp/data/sync.ts?raw')) },
      {
        path: 'src/webapp/data/connections.ts',
        load: raw(() => import('#src/webapp/data/connections.ts?raw')),
      },
    ],
  },
  {
    id: 'auth',
    title: 'Auth & tenancy',
    subtitle: 'better-auth + workspace',
    kind: 'web',
    x: 250,
    y: 150,
    summary:
      'better-auth (Google login) owns sessions; a user-create hook auto-provisions org → membership → product → dashboard on first login. requireUserWorkspace() (in data/session.server.ts) is the single tenant guard: it resolves the signed-in user’s workspace and throws otherwise. Everything multi-tenant flows through it. Note: session.server.ts itself is not browsable here — TanStack Start’s import-protection refuses to ship any *.server.ts file to the client, even as raw text. The guard guarding itself.',
    invariants: [
      'One guard, used everywhere: requireUserWorkspace(). No duplicated scoping logic.',
    ],
    files: [
      {
        path: 'src/webapp/data/workspace.ts',
        load: raw(() => import('#src/webapp/data/workspace.ts?raw')),
      },
      {
        path: 'src/webapp/data/auth.ts',
        load: raw(() => import('#src/webapp/data/auth.ts?raw')),
      },
    ],
  },
  {
    id: 'dispatcher',
    title: 'Dispatcher λ',
    subtitle: 'src/lambda/ingestion-dispatcher',
    kind: 'aws',
    x: 740,
    y: 150,
    summary:
      'Planning only — no vendor I/O, so a vendor outage can never stall the tick. Reads pending/active connections, asks each adapter’s capabilities() for its recommended cadence, and enqueues one FIFO message per due connection. Error-status connections are excluded: a dead credential is not retried forever; reconnecting flips it back to active.',
    files: [
      {
        path: 'src/lambda/ingestion-dispatcher.ts',
        load: raw(() => import('#src/lambda/ingestion-dispatcher.ts?raw')),
      },
    ],
  },
  {
    id: 'sync-trigger',
    title: 'Sync trigger',
    subtitle: 'the ONE write path',
    kind: 'domain',
    x: 480,
    y: 150,
    summary:
      'requestConnectionSync() is the single entry point for “sync these connections now”. Deployed, it enqueues to the FIFO queue — the same path the scheduler uses — so a manual Sync-now click or an OAuth auto-sync can never race a scheduled run. In local dev (no queue configured) it falls back to inline sync so `vp dev` works unchanged.',
    invariants: [
      'All sync requests — scheduled, manual, connect-time — converge on one write path.',
    ],
    files: [
      {
        path: 'src/webapp/data/sync-trigger.ts',
        load: raw(() => import('#src/webapp/data/sync-trigger.ts?raw')),
      },
    ],
  },
  {
    id: 'sqs',
    title: 'SQS FIFO + DLQ',
    subtitle: 'MessageGroupId = connectionId',
    kind: 'aws',
    x: 740,
    y: 280,
    summary:
      'The FIFO group id serializes all work for one connection at the queue layer — the concurrent-sync cursor race is impossible by construction, with no database locking — while different connections still process in parallel. Three failed receives dead-letter the message to a FIFO DLQ for inspection.',
    invariants: [
      'Per-connection serialization is a correctness mechanism, not an ordering nicety.',
    ],
    files: [
      {
        path: 'lib/constructs/MetricsIngestion.ts',
        load: raw(() => import('../../../../lib/constructs/MetricsIngestion.ts?raw')),
      },
    ],
  },
  {
    id: 'worker',
    title: 'Worker λ',
    subtitle: 'src/lambda/ingestion-worker',
    kind: 'aws',
    x: 740,
    y: 410,
    summary:
      'Consumes the queue (one connection per message) and routes failures through the ProviderError taxonomy: transient / rate-limited errors are reported as batch item failures so SQS redelivers (and eventually dead-letters); auth / permanent errors flip the connection to status=error so the dispatcher stops enqueueing a dead credential.',
    invariants: ['Retry policy is decided by error KIND, not by catch-all retries.'],
    files: [
      {
        path: 'src/lambda/ingestion-worker.ts',
        load: raw(() => import('#src/lambda/ingestion-worker.ts?raw')),
      },
    ],
  },
  {
    id: 'domain',
    title: 'Sync domain',
    subtitle: 'syncConnection → runIngestion',
    kind: 'domain',
    x: 480,
    y: 410,
    summary:
      'The shared core of ingestion, written once and called from three transports (server fn, OAuth callback, SQS worker). syncConnection() loads the adapter + secret, computes the fetch window from the adapter’s capabilities (incremental cursor, data-lag re-pull), and calls runIngestion(), which pages through the adapter, idempotently upserts metric points, records a sync_run audit row, and advances the cursor.',
    invariants: [
      'Plain functions — no transport, no framework. This is why three callers can share it.',
      'Upserts are idempotent via the metric_points composite PK; re-running a window is harmless.',
    ],
    files: [
      {
        path: 'src/webapp/data/sync-connection.ts',
        load: raw(() => import('#src/webapp/data/sync-connection.ts?raw')),
      },
      {
        path: 'src/webapp/data/ingest.ts',
        load: raw(() => import('#src/webapp/data/ingest.ts?raw')),
      },
    ],
  },
  {
    id: 'registry',
    title: 'Adapter port + registry',
    subtitle: 'providers/core',
    kind: 'domain',
    x: 480,
    y: 540,
    summary:
      'The hexagonal boundary. MetricSourceAdapter is the port every provider implements (catalog, capabilities, validateConnection, fetchTimeSeries over canonical MetricPoints); the registry is the single allow-list mapping ProviderId → factory. The error taxonomy (auth / transient / rate-limited / permanent) and httpJson live here so every adapter fails in a way the worker can classify.',
    invariants: [
      'Adding a provider = a new providers/<id>/ folder + one registry line. The engine is never edited.',
      'Engine code skips unregistered providers instead of crashing (one bad row can’t poison a sync loop).',
    ],
    files: [
      {
        path: 'src/webapp/integrations/providers/core/adapter.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/adapter.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/providers/core/registry.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/registry.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/providers/core/types.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/types.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/providers/core/errors.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/errors.ts?raw')),
      },
    ],
  },
  {
    id: 'adapters',
    title: 'Adapters',
    subtitle: 'gsc · posthog · plausible · fathom',
    kind: 'domain',
    x: 250,
    y: 540,
    summary:
      'One folder per provider: config schema (Zod), secret schema (Zod), a canonical-metric mapping, and a factory returning the adapter. Each adapter validates its own config/secret, encapsulates its rate limiter, and normalizes vendor responses into canonical MetricPoints (currency in minor units, ratios 0..1, UTC day buckets). PostHog queries HogQL via the REST query endpoint; GSC refreshes OAuth tokens on demand; all use raw REST through httpJson — never vendor SDKs.',
    invariants: [
      'Adapters import only providers/core/* — never Drizzle, the AWS SDK, or HTTP frameworks.',
      'fetchImpl is injectable, so every adapter is unit-testable with a fake fetch.',
    ],
    files: [
      {
        path: 'src/webapp/integrations/providers/posthog/index.ts',
        load: raw(() => import('#src/webapp/integrations/providers/posthog/index.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/providers/gsc/index.ts',
        load: raw(() => import('#src/webapp/integrations/providers/gsc/index.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/providers/plausible/index.ts',
        load: raw(() => import('#src/webapp/integrations/providers/plausible/index.ts?raw')),
      },
    ],
  },
  {
    id: 'vendors',
    title: 'Vendor APIs',
    subtitle: 'Google · PostHog · …',
    kind: 'external',
    x: 20,
    y: 540,
    summary:
      'The third-party services themselves, reached over plain REST through httpJson, which maps transport failures and HTTP statuses onto the provider error taxonomy (401/403 → auth, 429 → rate-limited with Retry-After, 5xx → transient). That mapping is what lets the worker decide retry-vs-give-up uniformly for every vendor.',
    files: [
      {
        path: 'src/webapp/integrations/providers/core/http.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/http.ts?raw')),
      },
    ],
  },
  {
    id: 'secrets',
    title: 'Secrets Manager',
    subtitle: 'per-connection credentials',
    kind: 'aws',
    x: 740,
    y: 540,
    summary:
      'Provider credentials never touch the database: each connection stores only a secret ARN, and the secret itself (API key, OAuth refresh token) lives at moimetric/<stage>/connections/<id>. The worker’s IAM grant is scoped to exactly that prefix. The adapter validates the secret JSON with its own Zod schema at use time.',
    files: [
      {
        path: 'src/webapp/integrations/providers/core/secret.ts',
        load: raw(() => import('#src/webapp/integrations/providers/core/secret.ts?raw')),
      },
    ],
  },
  {
    id: 'turso',
    title: 'Turso (libSQL)',
    subtitle: 'Drizzle ORM — one data layer',
    kind: 'data',
    x: 20,
    y: 280,
    summary:
      'The single system of record: orgs/products/users, source_connections, the hot metric_points table (composite PK, WITHOUT ROWID, so the PK is the physical clustering order for range scans), sync_runs audit, dashboards/charts. Ephemeral state (rate limits, dedupe windows) will live here too in TTL’d tables — DynamoDB is deferred behind a measured trigger (system-design §5).',
    invariants: [
      'metric_points composite PK doubles as the upsert idempotency key.',
      'One datastore: no second database without a measured trigger.',
    ],
    files: [
      {
        path: 'src/webapp/integrations/turso/schema.ts',
        load: raw(() => import('#src/webapp/integrations/turso/schema.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/turso/db.ts',
        load: raw(() => import('#src/webapp/integrations/turso/db.ts?raw')),
      },
      {
        path: 'src/webapp/integrations/turso/client.ts',
        load: raw(() => import('#src/webapp/integrations/turso/client.ts?raw')),
      },
    ],
  },
];

export const EDGES: ArchEdge[] = [
  { from: 'dashboard-ui', to: 'server-fns', label: 'typed RPC' },
  { from: 'dashboard-ui', to: 'oauth-flow', label: 'Connect GSC' },
  { from: 'oauth-flow', to: 'sync-trigger', label: 'auto-sync on connect' },
  { from: 'oauth-flow', to: 'turso', label: 'insert connection + charts' },
  { from: 'server-fns', to: 'auth', label: 'requireUserWorkspace()' },
  { from: 'server-fns', to: 'turso', label: 'read series + charts' },
  { from: 'server-fns', to: 'sync-trigger', label: 'Sync now / connect' },
  { from: 'sync-trigger', to: 'sqs', label: 'enqueue (deployed)' },
  { from: 'sync-trigger', to: 'domain', label: 'inline (local dev)' },
  { from: 'scheduler', to: 'dispatcher', label: 'hourly tick' },
  { from: 'dispatcher', to: 'turso', label: 'read due connections' },
  { from: 'dispatcher', to: 'sqs', label: '1 msg per connection' },
  { from: 'sqs', to: 'worker', label: 'per-connection serial' },
  { from: 'worker', to: 'domain', label: 'syncConnection()' },
  { from: 'domain', to: 'registry', label: 'getAdapter()' },
  { from: 'domain', to: 'secrets', label: 'load credentials' },
  { from: 'domain', to: 'turso', label: 'upsert points + sync_runs' },
  { from: 'registry', to: 'adapters', label: 'factory per provider' },
  { from: 'adapters', to: 'vendors', label: 'REST via httpJson' },
];

export const KIND_LABELS: Record<NodeKind, string> = {
  web: 'Web app',
  domain: 'Domain core',
  aws: 'AWS infra',
  data: 'Data layer',
  external: 'External',
};
