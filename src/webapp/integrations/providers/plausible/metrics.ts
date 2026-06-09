import type { CanonicalMetricKey } from '#src/webapp/integrations/providers/core/types.ts';

const PERCENT_TO_RATIO = 100;
const identity = (raw: number): number => raw;

interface PlausibleMetricMap {
  native: string; // Plausible metric name
  toValue: (raw: number) => number; // normalize to canonical units (ratio 0..1, etc.)
}

// Canonical metric -> Plausible native metric. Only mapped metrics are supported.
export const PLAUSIBLE_METRICS: Partial<Record<CanonicalMetricKey, PlausibleMetricMap>> = {
  pageviews: { native: 'pageviews', toValue: identity },
  visitors: { native: 'visitors', toValue: identity },
  bounce_rate: { native: 'bounce_rate', toValue: (raw) => raw / PERCENT_TO_RATIO },
  avg_session: { native: 'visit_duration', toValue: identity },
};
