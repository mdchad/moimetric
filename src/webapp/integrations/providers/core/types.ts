import { z } from 'zod';

// Providers known to the system. Adding a provider = extend this enum + register
// a factory in registry.ts + add a providers/<id>/ folder.
export const ProviderId = z.enum([
  'plausible',
  'fathom',
  'revenuecat',
  'stripe',
  'posthog',
  'sentry',
  'gsc',
]);
export type ProviderId = z.infer<typeof ProviderId>;

export const Granularity = z.enum(['day', 'week', 'month']);
export type Granularity = z.infer<typeof Granularity>;

// How a metric's value aggregates when buckets are combined (downsampling).
export const MetricUnit = z.enum(['count', 'currency', 'ratio', 'gauge', 'duration']);
export type MetricUnit = z.infer<typeof MetricUnit>;

export const MetricKind = z.enum(['sum', 'average', 'last', 'max']);
export type MetricKind = z.infer<typeof MetricKind>;

// Canonical, provider-agnostic metric identifiers. Each provider maps its native
// metrics onto these so charts are uniform across sources.
export const CanonicalMetricKey = z.enum([
  // web analytics (Plausible / Fathom)
  'pageviews',
  'visitors',
  'bounce_rate',
  'avg_session',
  // revenue (Stripe / RevenueCat)
  'revenue',
  'mrr',
  'active_subscriptions',
  // product analytics (PostHog)
  'active_users',
  'events',
  // errors (Sentry)
  'errors',
  // search (GSC)
  'clicks',
  'impressions',
  'ctr',
  'avg_position',
]);
export type CanonicalMetricKey = z.infer<typeof CanonicalMetricKey>;

export interface CanonicalMetric {
  key: CanonicalMetricKey;
  label: string;
  unit: MetricUnit;
  kind: MetricKind;
  // Currency metrics store integer minor units (e.g. cents) to avoid float drift.
  currencyMinorUnits?: boolean;
}

// The single normalized point every adapter emits.
export const MetricPoint = z.object({
  metricKey: CanonicalMetricKey,
  bucketTs: z.number().int(), // epoch ms, UTC, truncated to the granularity boundary
  granularity: Granularity,
  value: z.number(), // currency in minor units; ratios as 0..1
  dims: z.record(z.string(), z.string()).optional(), // breakdown; absent/empty = total
});
export type MetricPoint = z.infer<typeof MetricPoint>;
