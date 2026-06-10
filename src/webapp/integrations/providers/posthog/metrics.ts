import type { CanonicalMetricKey } from '#src/webapp/integrations/providers/core/types.ts';

interface PosthogMetricMap {
  select: string; // HogQL aggregate expression
  pageviewOnly: boolean; // restrict to $pageview events (web-analytics metrics)
}

// Canonical metric -> HogQL aggregate. Only mapped metrics are supported.
export const POSTHOG_METRICS: Partial<Record<CanonicalMetricKey, PosthogMetricMap>> = {
  pageviews: { select: 'count()', pageviewOnly: true },
  visitors: { select: 'uniq(person_id)', pageviewOnly: true },
  events: { select: 'count()', pageviewOnly: false },
  active_users: { select: 'uniq(person_id)', pageviewOnly: false },
};
