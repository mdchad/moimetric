import type { CanonicalMetricKey } from '#src/webapp/integrations/providers/core/types.ts';

// Field on a searchAnalytics row. ctr is already a 0..1 ratio; position is a gauge.
export type GscField = 'clicks' | 'impressions' | 'ctr' | 'position';

export const GSC_METRICS: Partial<Record<CanonicalMetricKey, GscField>> = {
  clicks: 'clicks',
  impressions: 'impressions',
  ctr: 'ctr',
  avg_position: 'position',
};
