import type {
  CanonicalMetric,
  CanonicalMetricKey,
  Granularity,
  MetricPoint,
  ProviderId,
} from './types.ts';

// Capabilities describe what a provider supports — drives scheduling cadence and
// windowing/backfill behaviour in the ingestion worker, plus UI metric pickers.
export interface ProviderCapabilities {
  granularities: Granularity[];
  maxWindowDays?: number; // max span per request (Fathom day-grouping = 180; GSC ~16mo)
  dataLagDays?: number; // settled-data delay to re-pull each run (GSC ~3)
  supportsDimensions: boolean;
  recommendedCadence: 'hourly' | 'daily';
}

export interface FetchTimeSeriesArgs {
  metricKey: CanonicalMetricKey;
  start: number; // epoch ms, inclusive
  end: number; // epoch ms, exclusive
  granularity: Granularity;
  cursor?: string | null; // opaque, adapter-defined; resumes a paged/keyset fetch
  signal?: AbortSignal;
}

export interface FetchTimeSeriesResult {
  points: MetricPoint[];
  nextCursor: string | null; // null => series complete for this window
  watermark?: number; // max fully-settled bucketTs (advances the connection cursor)
}

export type ConnectionValidation = { ok: true } | { ok: false; reason: string };

// The port every provider implements. config/secret arrive as raw `unknown`
// (DB JSON + Secrets Manager JSON); each adapter validates them with its own Zod
// schemas internally. This keeps the registry homogeneous (no casts) and keeps
// validation co-located with the adapter. Adapters depend only on this + core
// types — never on Drizzle, the AWS SDK, or any HTTP framework.
export interface MetricSourceAdapter {
  readonly providerId: ProviderId;
  catalog(): CanonicalMetric[];
  capabilities(): ProviderCapabilities;
  validateConnection(args: {
    config: unknown;
    secret: unknown;
    signal?: AbortSignal;
  }): Promise<ConnectionValidation>;
  fetchTimeSeries(
    args: FetchTimeSeriesArgs & { config: unknown; secret: unknown },
  ): Promise<FetchTimeSeriesResult>;
}

// Dependencies injected into adapter factories (testability: swap fetch in tests).
export interface AdapterDeps {
  fetchImpl?: typeof fetch;
}

export type AdapterFactory = (deps?: AdapterDeps) => MetricSourceAdapter;
