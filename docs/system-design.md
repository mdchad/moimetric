# Moimetric — System Design & Architecture

Status: **Draft v1** · Owner: @mdchad · Last updated: 2026-06-09

> This spec maps the target architecture for Moimetric: a **notification-first, cross-source
> metrics watchdog** for solo devs and small SaaS teams. It builds on the existing adapter
> port and Turso store, and adds the missing engine: scheduled ingestion, anomaly detection,
> cross-source correlation, tiered notifications, and an MCP server.

---

## 1. Product thesis (what the architecture must serve)

The product is **not** "another dashboard." The dashboard is the entry point; the product is:

1. **Watch every source on a cadence** (GSC, Stripe, RevenueCat, PostHog, Sentry, …).
2. **Detect when a metric breaks its own baseline** — including slow, multi-day bleeds, not just spikes.
3. **Correlate the break across sources** ("revenue −22% correlates with a −19% visitor drop, right after v2.3.1").
4. **Push one tiered notification** so the user becomes aware _early_.
5. **Hand off to an agent** (via MCP) to investigate or fix.

Two design consequences fall directly out of this thesis and drive every decision below:

- **Correlation quality is existential**, not a feature. A coincidence generator gets muted. The
  detection core must strip baseline + seasonality and correlate **residuals**, lag-aligned.
- **Adding a new source must stay cheap.** Breadth of integrations is the moat-over-time
  (per-account causal graph). The adapter port already makes this a 4-file change — the engine
  must preserve that, never regress it.

---

## 2. Architecture principles

1. **Ports & adapters (hexagonal).** The domain (ingestion, detection, alerting) depends on
   _ports_, never on vendors or AWS. The existing `MetricSourceAdapter`
   (`src/webapp/integrations/providers/core/adapter.ts`) is the model: adapters depend only on
   core types — "never on Drizzle, the AWS SDK, or any HTTP framework." Every new boundary
   (notification delivery, key auth, event bus) follows the same rule.
2. **Functional core, imperative shell.** All detection/correlation math is **pure, deterministic,
   I/O-free** functions (`detection/core/*`) — trivially unit-testable with `vp test`. AWS, Turso,
   and HTTP live in a thin shell (Lambda handlers, server functions) that calls the core.
3. **AWS is the shell, not the domain.** EventBridge / SQS / Scheduler / SNS wire components
   together and run them on a cadence. No domain logic lives in CDK or in handler glue.
4. **One extension point per concern.** New provider → adapter registry. New notification channel
   → `Notifier` registry. New detector → detector registry. Adding capability never means editing
   a switch in five files.
5. **Idempotency everywhere async.** Every queue consumer and event handler is safe to retry. The
   `metric_points` composite PK is already the idempotency key for upserts; the same discipline
   applies to detection runs and notification sends (dedupe keys).

---

## 3. Current state (baseline we build on)

| Area                                     | Today                                                                                                                                       | Verdict                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Provider integration                     | `MetricSourceAdapter` port + registry; `gsc`, `plausible`, `fathom` live                                                                    | **Keep — it's the foundation**                                 |
| Canonical model                          | `CanonicalMetricKey`, `MetricPoint`, units/kinds, currency minor-units                                                                      | **Keep**                                                       |
| Storage                                  | Turso (libSQL) via Drizzle: `source_connections`, `metric_points` (WITHOUT ROWID), `sync_runs`, `dashboards`, `charts`, orgs/products/users | **Keep for v1** (§5)                                           |
| Ingestion                                | `runIngestion()` in `data/ingest.ts`, triggered on-demand by `syncProduct()` server fn, in the web Lambda                                   | **Reuse the function; move the trigger to a scheduled worker** |
| Compute                                  | Single Nitro Lambda behind API GW + CloudFront; S3 assets; Secrets Manager for Turso + per-connection creds                                 | **Keep web Lambda; add worker Lambdas**                        |
| Async / scheduling                       | **None** — no EventBridge, SQS, SNS, Step Functions, schedules                                                                              | **Add (the bulk of this spec)**                                |
| Detection / alerts / notifications / MCP | **None**                                                                                                                                    | **Add**                                                        |

The single most important existing fact: **`runIngestion()` already exists and is pure of triggers.**
We do not rewrite ingestion — we put a scheduler and a queue in front of it.

---

## 4. Target architecture overview

```
                         ┌────────────────────────────────────────────────────────────┐
                         │                     EVENT-DRIVEN PIPELINE                    │
                         └────────────────────────────────────────────────────────────┘

  EventBridge Scheduler            SQS: ingest-queue            EventBridge bus: "moimetric.metrics"
  (every 5 min tick)                  (+ DLQ)                       (domain events)
        │                               │                                │
        ▼                               ▼                                ▼
 ┌─────────────┐   due connections ┌──────────────┐  IngestionCompleted ┌──────────────┐
 │  Planner λ  │──enqueue (conn, ──▶│  Ingest λ    │──────emit event────▶│ Detection λ  │
 │ enumerate   │   metric, window)  │ runIngestion │                     │ baseline +   │
 │ due conns   │                    │ → upsert     │                     │ trend-break  │
 └─────────────┘                    │ metric_points│                     │ + correlate  │
        ▲                           └──────────────┘                     └──────┬───────┘
        │ reads recommendedCadence,         │                                   │ AnomalyDetected
        │ lastSyncedAt, capabilities        │ writes                            ▼
        │                                    ▼                            ┌──────────────┐
        │                              ┌──────────┐                       │  Alerting λ  │
   (Turso: source_connections)        │  TURSO   │◀──reads series────────│ severity +   │
                                       │ (durable │                       │ dedupe +     │
                                       │  domain) │                       │ fatigue      │
                                       └──────────┘                       └──────┬───────┘
                                            ▲                                    │ NotificationRequested
   ┌─────────────────────────┐             │                                    ▼
   │  DynamoDB (ephemeral)    │             │                             ┌──────────────┐
   │  rate limits, dedupe     │             │                             │  Notify λ    │
   │  windows, idempotency    │             │                             │ Notifier port│
   │  (TTL'd)                 │             │                             │ → Expo/SES/  │
   └─────────────────────────┘             │                             │   SNS        │
                                            │                             └──────┬───────┘
  ┌───────────────────────────────────────┼──────────────────┐                 │
  │             WEB LAMBDA (existing Nitro, API GW + CloudFront)               push/email
  │  • SSR dashboard + server functions (charts read metric_points)           │
  │  • OAuth/connect flows                                                      ▼
  │  • MCP server (remote, key-auth, scoped, rate-limited) ◀──── opencode / Claude / Cursor
  └────────────────────────────────────────────────────────────┘
```

**Read path (dashboard & MCP)** stays in the web Lambda — synchronous, cache-warm, the same
Drizzle queries that exist today. **Write/compute path (ingest → detect → alert → notify)** is
async, event-driven, isolated into purpose-built Lambdas so a slow vendor API or a detection bug
can never take down SSR.

---

## 5. Storage strategy (decision)

**Decision: keep Turso as the system of record for v1. Add one DynamoDB table for hot ephemeral
state. Defer Amazon Timestream until cardinality forces it.**

Rationale:

- **Turso (durable domain).** Already holds the relational domain (orgs/products/connections/
  charts) and the `metric_points` hot table with a well-chosen composite PK + WITHOUT ROWID
  clustering. Ripping it out now is scope creep with no user-visible payoff. Relational joins
  (connection → product → org, chart discovery, alert history) are exactly what SQLite is good at.
  Keep it.
- **DynamoDB (ephemeral, high-write, TTL'd).** Three needs don't belong in a relational store
  because they're hot, write-heavy, and disposable: **MCP rate-limit counters**, **alert dedupe
  windows**, and **idempotency receipts** for queue consumers. A single-table DynamoDB design with
  per-item TTL is the AWS-native fit (atomic `ADD`, automatic expiry, no vacuum). This also gives
  us a clean home for anything that must survive a Lambda but not the week.
- **Amazon Timestream for LiveAnalytics (deferred).** If/when `metric_points` cardinality explodes
  (many products × many sources × dimensional breakdowns × daily history), a purpose-built
  time-series store with built-in interpolation and windowed aggregation becomes attractive for the
  detection read path. **Trigger to revisit:** detection read latency p95 > 500 ms or
  `metric_points` > ~50 M rows. Until then, YAGNI.

> The `MetricPoint` canonical type is the abstraction boundary. Because detection reads through a
> `MetricStore` port (§6.4), swapping the physical store later does not touch the detection core.

---

## 6. Component specifications

### 6.1 Ingestion engine

Turns "sync when the user clicks a button" into "every source stays fresh on its own cadence,"
without rewriting `runIngestion()`.

**Planner Lambda** (`src/lambda/ingest-planner.ts`)

- Triggered by **EventBridge Scheduler**, fixed rate (every 5 min — matches the dashboard
  `POLL_MS`).
- Query `source_connections` where `status = 'active'` and the connection is **due**:
  `now - lastSyncedAt >= cadenceMs(provider.capabilities().recommendedCadence)`.
- For each due connection, enqueue one SQS message per **work unit**. A work unit is
  `{ connectionId, metricKey, window }`, where the window is derived from the adapter's
  `capabilities()` (`maxWindowDays`, `dataLagDays` — always re-pull the last `dataLagDays` to
  capture settled data, e.g. GSC's 3-day lag).
- The planner does **no** vendor I/O. It only reads connection rows and fans out. This keeps it
  fast, cheap, and immune to vendor outages.

**Ingest queue** — Amazon SQS standard, with a **dead-letter queue** (maxReceiveCount 3).

- Decouples planning from execution; absorbs vendor rate limits and bursts.
- Visibility timeout ≥ 6× the worker's expected runtime.

**Ingest Worker Lambda** (`src/lambda/ingest-worker.ts`)

- SQS event source, small batch size, partial-batch-failure reporting on.
- For each message: load adapter via `getAdapter(providerId)`, load secret from Secrets Manager,
  call the **existing** `runIngestion()` with that single work unit, which upserts `metric_points`
  (idempotent) and advances the connection cursor + writes a `sync_runs` row.
- On success, emit a single **`IngestionCompleted`** domain event to the EventBridge bus
  (`{ productId, connectionId, metricKey, affectedWindow, watermark }`). This is the only coupling
  to detection — fully decoupled, fan-out-friendly.
- Idempotency: ingestion upserts are already idempotent; the event emit is deduped via a DynamoDB
  receipt keyed by `(connectionId, metricKey, runId)` so a re-delivered SQS message doesn't double-fire detection.

**Why SQS + Scheduler over per-connection EventBridge schedules or Step Functions:** per-connection
schedules don't scale to thousands of connections and are painful to manage; Step Functions is
overkill for a stateless fan-out. A planner-tick + queue is the simplest thing that scales and
self-heals (DLQ + retries).

### 6.2 Domain event bus

A single **EventBridge custom bus** (`moimetric.metrics`) carries domain events:
`IngestionCompleted` → Detection, `AnomalyDetected` → Alerting, `NotificationRequested` → Notify.

- Decouples stages: each consumer is an independent Lambda with its own retry/DLQ.
- Adding a future consumer (e.g. a webhook fan-out, an analytics sink) is "add a rule," not a code
  change to producers.
- Events are versioned (`detail.schemaVersion`) and validated with Zod at the consumer edge.

### 6.3 Detection engine — **the core of the product**

Split rigorously into a **pure core** (math, no I/O) and a **shell** (the Lambda that loads data
and persists results). The core is where correlation quality is won or lost, and it must be
exhaustively unit-tested.

**Pure core** (`src/webapp/detection/core/`, no AWS, no Drizzle, no fetch):

- `baseline.ts` — given a `MetricPoint[]` series, compute the expected value + expected range:
  rolling trailing-window baseline (e.g. 28-day) with robust statistics (median/MAD, not
  mean/stddev — resistant to the very spikes we're hunting).
- `seasonality.ts` — remove weekly seasonality before judging a break. Same-weekday-week-over-week
  comparison or STL-style decomposition. **This is the anti-false-positive layer** — without it we
  fire every Saturday and get muted.
- `trend-break.ts` — detect both **point anomalies** (sudden) and **trend breaks** (slow bleed: the
  7-day trailing average drifting below the 28-day baseline). Returns a normalized **residual
  series** (observed − expected) plus a break descriptor (`{ direction, magnitude, confidence,
window }`).
- `correlate.ts` — given two residual series, **lag-align** them (each source declares its lag via
  `capabilities().dataLagDays`) and score correlation on the **residuals**, not raw values. Returns
  `{ coefficient, lag, overlapWindow }`. Correlating residuals + lag alignment is what makes
  "revenue drop correlates with visitor drop" trustworthy instead of "everything correlates on
  weekends."

All four are deterministic `(input) => output` functions. Test vectors live beside them
(`*.test.ts`), runnable with `vp test`.

**Detection shell** (`src/lambda/detect.ts`):

- Consumes `IngestionCompleted`.
- Loads the relevant series via the `MetricStore` port (Turso today), runs baseline → seasonality →
  trend-break.
- If a break is found, loads **sibling series** for the same product (other connections/metrics)
  within the break window, runs `correlate` pairwise, and attaches the strongest correlations +
  any **release annotation** (§6.5) inside the window.
- Persists an `anomalies` row and emits **`AnomalyDetected`** with the break + correlations +
  annotation context. Detection does **not** decide whether to notify — that's Alerting's job
  (separation of concerns: detection finds, alerting judges + throttles).

**Per-provider detection profile (the only adapter extension).** To keep detection provider-aware
without coupling, extend the **existing** declarations rather than adding a new required method:

- `ProviderCapabilities` gains optional `seasonality?: 'weekly' | 'none'` (web/search = weekly;
  revenue often weekly too).
- `CanonicalMetric` (the `catalog()` entries) gains optional alerting hints:
  `alertable?: boolean`, `direction?: 'down_is_bad' | 'up_is_bad' | 'either'`,
  `defaultSeverity?: Severity`.

These are **optional** — an adapter author can ignore them and get sane defaults. Adding a provider
stays a 4-file change; tuning its alerting is an incremental opt-in. This is the clean-code win:
the provider remains the single source of truth for its own metrics _and_ their alert semantics,
and detection reads those hints generically.

### 6.4 Ports introduced

```ts
// src/webapp/detection/core/store.ts — detection depends on this, never on Drizzle.
export interface MetricStore {
  getSeries(args: {
    connectionId: string;
    metricKey: CanonicalMetricKey;
    granularity: Granularity;
    start: number;
    end: number;
  }): Promise<MetricPoint[]>;
  getSiblingSeries(args: {
    productId: string;
    window: { start: number; end: number };
  }): Promise<
    Array<{ connectionId: string; metricKey: CanonicalMetricKey; points: MetricPoint[] }>
  >;
}
```

A `TursoMetricStore` implements it now; a `TimestreamMetricStore` could later — detection core
never notices.

### 6.5 Release / annotation markers

The thing that turns N independent alerts into one causal story ("…right after v2.3.1").

- New table `annotations` (§9): `{ productId, ts, kind: 'deploy'|'release'|'manual'|'experiment',
label, source, meta }`.
- Ingested three ways: (a) deploy webhooks (GitHub Actions / Vercel / EAS) hitting a thin route
  `api.annotations.ingest`; (b) derived automatically from RevenueCat/App Store app-version
  changes during ingestion; (c) manual add in the UI.
- Detection queries annotations within a break window and attaches the nearest preceding one to the
  anomaly. **First-class concept, not an afterthought** — it's half the value of every alert.

### 6.6 Alerting (judge + throttle)

Detection finds breaks; alerting decides what is worth a human's attention and at what urgency.

- **Severity tiers:** `critical` (wake-me: revenue cliff, error spike post-deploy) →
  `warning` (digest: gradual GSC decline) → `info`. Derived from magnitude × confidence ×
  metric `defaultSeverity` × whether a correlation/annotation raises it.
- **Dedupe / fatigue control:** a DynamoDB dedupe window keyed by
  `(productId, connectionId, metricKey, severity)` collapses repeated detections of the same
  ongoing break into one alert with an updated "still ongoing" state — not a daily re-ping. **This
  is the single most important churn-prevention mechanism in the system.**
- **Feedback loop:** every alert carries an id; `alert_feedback` records `useful | not_useful |
mute_this_kind`. Feedback feeds back into per-product/per-metric thresholds over time. Build this
  in from day one — without it the system can't learn each user's baseline and will over- or
  under-fire.
- Emits **`NotificationRequested`** with channel-agnostic payload + computed severity.

### 6.7 Notification delivery

A clean port so channels are pluggable and the domain never imports a vendor SDK.

```ts
// src/webapp/notify/core/notifier.ts
export interface Notifier {
  readonly channel: 'push' | 'email' | 'webhook';
  send(args: { to: NotifyTarget; alert: AlertPayload; signal?: AbortSignal }): Promise<void>;
}
```

- **Channels (registry, mirrors the adapter registry):**
  - `push` → **Expo Push** first (mobile app is React Native/Expo). AWS-native alternative
    behind the same port: **Amazon SNS mobile push / Pinpoint** — swap without touching alerting.
  - `email` → **Amazon SES** (digests, warning-tier).
  - `webhook` → Slack/Discord/generic (power users, "post to my channel").
- The notification payload includes the **agent handoff deep link** (§6.8): a ready-to-run prompt
  pre-filled with the source, metric, window, and correlation, so tapping the notification jumps
  the user straight into their agent with full context. **The notification is the handoff seam.**
- Per-user channel prefs + push tokens in Turso (`notification_targets`); severity→channel routing
  (critical → push immediately; warning → batched email digest).

### 6.8 MCP server

The second product surface (alongside the UI), modeled on the GSC-Wizard pattern we studied:
remote, key-authenticated, scoped, rate-limited.

- **Transport & hosting:** remote **Streamable HTTP** MCP served _from the existing web Lambda_
  (new route, e.g. `routes/api.mcp.$.ts`). It's read-mostly over the same Drizzle queries the
  dashboard uses — no separate compute needed. **Not** a local stdio server.
- **Auth:** per-key API keys minted in the UI; store only a **hash** (`mcp_api_keys`, §9) plus
  `scope`, `name`, `lastUsedAt`, `revokedAt`. Resolve key → product/org on each call.
- **Scopes:** `read` (query series, list anomalies, run reports) vs `write` (mutations — trigger a
  re-sync, acknowledge/mute an alert, add an annotation). Split write into capability scopes later
  (`alerts:write`, `annotations:write`) rather than one coarse toggle. **Mutations are audit-logged.**
- **Rate limiting:** per-**account** token bucket in DynamoDB (atomic `ADD` + TTL), e.g. 60/min,
  1000/hr shared across an account's keys; respond `429 + Retry-After`. Protocol handshakes
  excluded.
- **Tools — designed for a _cold_ autonomous agent** (it arrives without UI context and must
  rediscover the problem):
  - `list_anomalies(productId?, since?, severity?)` — what's currently broken.
  - `get_metric_series(connectionId, metricKey, range, granularity)` — raw series.
  - `compare_periods(connectionId, metricKey, rangeA, rangeB)` — returns deltas + % change, not
    raw rows (so the model doesn't do arithmetic to see a dip).
  - `breakdown(connectionId, metricKey, by, range)` — dimensional drill (query/page/country/device).
  - `get_correlations(anomalyId)` — the cross-source story + annotations for a break.
  - `list_connections(productId)` / `list_annotations(productId, range)` — context.
  - **write-scope:** `trigger_sync(connectionId)`, `acknowledge_alert(alertId)`,
    `add_annotation(productId, …)`.
- **Return shapes carry reasoning context** (deltas, baselines, % change, units) so a model reaches
  a conclusion without re-deriving math. Tool ergonomics — not key auth — are where this surface
  wins; the auth/limits are table stakes.

---

## 7. Adding a new service (the contract we must protect)

Adding a provider stays a **4-file change + 2 registrations**, exactly as today:

```
src/webapp/integrations/providers/<id>/
  config.ts     // Zod schema: provider config (e.g. Stripe accountId)
  secret.ts     // Zod schema: credentials (e.g. restricted API key / OAuth refresh token)
  metrics.ts    // map canonical keys → native fields; optional alert hints (alertable, direction)
  index.ts      // factory → MetricSourceAdapter (validateConnection + fetchTimeSeries)
```

1. Add `<id>` to `ProviderId` (`core/types.ts`).
2. Register the factory in `core/registry.ts`.

**That's it.** The provider automatically gets: scheduled ingestion (planner reads its
`capabilities()`), idempotent storage, detection (reads its `catalog()` alert hints + `seasonality`),
correlation against sibling sources, alerting, notification, and MCP exposure — **with zero changes
to the engine.** New canonical metrics (only if genuinely new, e.g. `churn_rate`) extend
`CanonicalMetricKey`. This invariant — _engine never edited to add a source_ — is the architectural
contract; any PR that breaks it is a design regression.

---

## 8. AWS infrastructure (new CDK constructs)

All new resources are CDK constructs under `lib/constructs/`, composed by `Webapp.ts`, and subject
to the existing cdk-nag aspects (expect suppressions + a `*.synth.test.ts` snapshot update — per
`CLAUDE.md`).

| Construct              | AWS resources                                                                                                                   | Notes                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IngestionPipeline`    | EventBridge **Scheduler** (rate 5 min) → Planner Lambda; **SQS** ingest-queue + **DLQ**; Ingest Worker Lambda (SQS source)      | Worker gets the same Secrets Manager grants the web Lambda has (`moimetric/<stage>/connections/*`)          |
| `DomainEventBus`       | EventBridge custom bus `moimetric.metrics` + rules → Detection/Alerting/Notify Lambdas, each with a DLQ                         | Versioned, Zod-validated events                                                                             |
| `DetectionWorkers`     | Detection Lambda, Alerting Lambda, Notify Lambda                                                                                | Detection/alerting need Turso secret; Notify needs Expo creds (secret) + **SES** + optional **SNS** publish |
| `EphemeralStateTable`  | **DynamoDB** single-table, on-demand, **TTL** enabled                                                                           | rate limits, dedupe windows, idempotency receipts                                                           |
| `NotificationChannels` | **SES** identity (+ DKIM), optional **SNS** platform application / **Pinpoint**                                                 | Email + mobile push                                                                                         |
| (web Lambda, extended) | new IAM: DynamoDB R/W on the ephemeral table; `events:PutEvents` on the bus (for MCP `trigger_sync`/`add_annotation`); SES send | MCP + annotation routes live here                                                                           |

**Stage lifecycle** (per `.cursor/rules/cdk-stage-lifecycle.mdc`): all new stateful resources
(SQS, DynamoDB, event bus) follow the ephemeral-vs-permanent removal-policy rules; ephemeral stages
auto-delete, permanent (`main`/`prod`) retain. No slug logic duplicated — everything flows through
`lib/stage-name.ts`.

**Why these services:** Scheduler (managed cron, no always-on poller), SQS (buffering + retries +
DLQ for vendor flakiness), EventBridge bus (decoupled fan-out, add-a-consumer extensibility),
DynamoDB (atomic TTL'd counters), SES/SNS (managed delivery). Each maps to a specific need above —
no service for its own sake.

---

## 9. Data model additions (Turso)

New Drizzle tables (migrations in `drizzle/`). Conventions match the existing schema: ULID ids,
epoch-ms integers, currency in minor units.

```
annotations            (productId, ts, kind, label, source, meta)            -- release markers
anomalies              (id, productId, connectionId, metricKey, window,      -- detected breaks
                        direction, magnitude, confidence, baseline,
                        correlations[json], annotationId?, status, createdAt)
alerts                 (id, anomalyId, severity, dedupeKey, state,           -- judged + throttled
                        firstFiredAt, lastFiredAt)
alert_feedback         (alertId, userId, verdict, createdAt)                 -- learning loop
notification_targets   (userId, channel, address/token, severityFloor,      -- delivery prefs
                        enabled)
mcp_api_keys           (id, orgId/productId, name, scope, keyHash,           -- MCP auth
                        lastUsedAt, createdAt, revokedAt)
mcp_audit_log          (id, keyId, tool, argsHash, ts, outcome)             -- write-scope audit
```

Ephemeral state (DynamoDB, TTL'd, **not** Turso): rate-limit buckets, alert dedupe windows,
ingestion idempotency receipts.

---

## 10. Module / folder layout (clean-code boundaries)

```
src/webapp/
  integrations/providers/        # EXISTS — adapters (unchanged contract)
    core/                        #   ports + canonical types + registry
    gsc/ plausible/ fathom/      #   + new: stripe/ revenuecat/ posthog/ sentry/
  detection/
    core/                        # PURE: baseline, seasonality, trend-break, correlate, store(port)
    detection.ts                 # shell: orchestration (called by the Lambda)
  alerting/
    core/                        # PURE: severity, dedupe-key, fatigue rules
    alerting.ts                  # shell
  notify/
    core/notifier.ts             # Notifier port + registry
    channels/                    # expo, ses, sns, webhook
  annotations/                   # ingest + query release markers
  mcp/
    server.ts                    # transport + dispatch
    tools/                       # one file per tool, Zod-validated
    auth.ts rate-limit.ts        # key resolution + DynamoDB token bucket
  data/                          # EXISTS — server functions (read path)
src/lambda/
  ingest-planner.ts ingest-worker.ts   # ingestion engine
  detect.ts alerting.ts notify.ts      # event consumers
lib/constructs/                  # EXISTS — + IngestionPipeline, DomainEventBus, etc.
```

The rule the layout enforces: **`detection/core`, `alerting/core`, and `notify/core` import nothing
from AWS, Drizzle, or `fetch`.** Lambdas (the shell) wire them to the world. This is what makes the
hard part — detection — fully testable with `vp test` and free of infra flakiness.

---

## 11. Security & multi-tenancy

- Every query is scoped by `productId`/`orgId`; the MCP key resolves to exactly one account and
  cannot read across tenants.
- Provider secrets stay in Secrets Manager (`moimetric/<stage>/connections/*`); the engine Lambdas
  get least-privilege grants to that prefix only — same pattern the web Lambda uses today.
- MCP write scope is opt-in per key, capability-split, and audit-logged (`mcp_audit_log`).
- cdk-nag suppressions documented inline per the existing convention.

---

## 12. Phased delivery (sequenced to the wedge)

The strategy work concluded: **lead with the proven dopamine (instant revenue charts), layer the
differentiation on top.** The build order follows that, not the architecture diagram's left-to-right.

- **Phase 0 — Scheduled ingestion (no user-visible change).** `IngestionPipeline` construct +
  planner/worker around the existing `runIngestion()`. Sources go from "sync on click" to "always
  fresh." Foundation for everything; ship it first because nothing else works without fresh data.
- **Phase 1 — The wedge: instant revenue.** Stripe + RevenueCat adapters (4-file each). A gorgeous,
  zero-setup revenue dashboard. This is where money already is; it validates acquisition before we
  invest in the hard engine.
- **Phase 2 — Detection + notifications on the highest-value silent source.** Detection core +
  alerting + Expo push, applied first to **GSC** (the original pain: silent gradual decline) and
  **Stripe** (silent churn/MRR). Annotations from deploy webhooks. This is the first "it caught
  something I'd have missed" moment.
- **Phase 3 — Cross-source correlation.** `correlate.ts` wired into detection once ≥2 sources per
  product are common (revenue + visitors). This is the actual moat — ship it once there's data to
  correlate.
- **Phase 4 — MCP server.** Read-scope tools over the now-rich data + the notification handoff deep
  link. Then write scope. The agent-fix loop closes (strongest on Sentry).
- **Phase 5 — Breadth.** PostHog, Sentry, AWS cost, more channels. Each is a 4-file adapter; the
  engine doesn't change. Switching cost + causal graph compound.

---

## 13. Open decisions (need a call before/early in build)

1. **Push provider:** Expo Push (matches the RN stack, fastest) vs Amazon SNS/Pinpoint (AWS-native,
   more setup). Recommendation: **Expo first behind the `Notifier` port**, SNS later if needed.
2. **Auth/identity:** schema notes "ownership moves to better-auth in a later phase." MCP keys and
   `notification_targets` assume a real user/org model — confirm better-auth lands before/with
   Phase 2.
3. **Detection cadence vs ingestion cadence:** detect on every `IngestionCompleted` (responsive,
   more compute) vs a batched detection tick (cheaper, slightly delayed). Recommendation:
   **event-driven for critical-tier sources (Stripe/Sentry), batched for daily-lag sources (GSC).**
4. **Timestream trigger:** confirm the revisit threshold (§5) so we don't prematurely migrate the
   metric store.
5. **MCP billing:** GSC-Wizard makes MCP free on every plan as acquisition. Confirm same posture
   (free read scope, paid write/volume?) — affects rate-limit defaults.

---

### Appendix: invariants a reviewer should enforce

- Adapters import only `providers/core/*` — never Drizzle, AWS SDK, or `fetch` directly.
- `detection/core`, `alerting/core`, `notify/core` are pure — no I/O imports.
- Adding a provider edits **only** `providers/<id>/*` + `ProviderId` + `registry.ts` — never the engine.
- Every async consumer is idempotent (dedupe key or idempotent upsert).
- New canonical metrics are added to `CanonicalMetricKey`, not smuggled as dimension strings.
