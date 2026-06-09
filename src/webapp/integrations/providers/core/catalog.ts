import type { CanonicalMetric, CanonicalMetricKey } from './types.ts';

// Canonical metric definitions. unit drives display formatting; kind drives how
// buckets combine when downsampling a wide date range.
export const CANONICAL_METRICS: Record<CanonicalMetricKey, CanonicalMetric> = {
  pageviews: { key: 'pageviews', label: 'Pageviews', unit: 'count', kind: 'sum' },
  visitors: { key: 'visitors', label: 'Visitors', unit: 'count', kind: 'sum' },
  bounce_rate: { key: 'bounce_rate', label: 'Bounce rate', unit: 'ratio', kind: 'average' },
  avg_session: { key: 'avg_session', label: 'Avg. session', unit: 'duration', kind: 'average' },
  revenue: {
    key: 'revenue',
    label: 'Revenue',
    unit: 'currency',
    kind: 'sum',
    currencyMinorUnits: true,
  },
  mrr: { key: 'mrr', label: 'MRR', unit: 'currency', kind: 'last', currencyMinorUnits: true },
  active_subscriptions: {
    key: 'active_subscriptions',
    label: 'Active subscriptions',
    unit: 'gauge',
    kind: 'last',
  },
  active_users: { key: 'active_users', label: 'Active users', unit: 'count', kind: 'average' },
  events: { key: 'events', label: 'Events', unit: 'count', kind: 'sum' },
  errors: { key: 'errors', label: 'Errors', unit: 'count', kind: 'sum' },
  clicks: { key: 'clicks', label: 'Clicks', unit: 'count', kind: 'sum' },
  impressions: { key: 'impressions', label: 'Impressions', unit: 'count', kind: 'sum' },
  ctr: { key: 'ctr', label: 'CTR', unit: 'ratio', kind: 'average' },
  avg_position: { key: 'avg_position', label: 'Avg. position', unit: 'gauge', kind: 'average' },
};
