import type { CanonicalMetricKey } from '#src/webapp/integrations/providers/core/types.ts';

const PERCENT_TO_RATIO = 100;
const identity = (raw: number): number => raw;

interface FathomMetricMap {
  aggregate: string; // Fathom aggregate name
  toValue: (raw: number) => number;
}

// Canonical metric -> Fathom aggregate. Note: Fathom reports bounce_rate as a
// percentage; normalized to a 0..1 ratio here.
export const FATHOM_METRICS: Partial<Record<CanonicalMetricKey, FathomMetricMap>> = {
  pageviews: { aggregate: 'pageviews', toValue: identity },
  visitors: { aggregate: 'uniques', toValue: identity },
  bounce_rate: { aggregate: 'bounce_rate', toValue: (raw) => raw / PERCENT_TO_RATIO },
  avg_session: { aggregate: 'avg_duration', toValue: identity },
};
