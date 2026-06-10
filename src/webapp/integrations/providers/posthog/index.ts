import { z } from 'zod';
import type {
  AdapterDeps,
  ConnectionValidation,
  FetchTimeSeriesResult,
  MetricSourceAdapter,
  ProviderCapabilities,
} from '#src/webapp/integrations/providers/core/adapter.ts';
import { CANONICAL_METRICS } from '#src/webapp/integrations/providers/core/catalog.ts';
import { permanentError, ProviderError } from '#src/webapp/integrations/providers/core/errors.ts';
import { httpJson } from '#src/webapp/integrations/providers/core/http.ts';
import { parseConfig, parseSecret } from '#src/webapp/integrations/providers/core/parse.ts';
import { RateLimiter } from '#src/webapp/integrations/providers/core/rate-limit.ts';
import { fromDateStringUtc } from '#src/webapp/integrations/providers/core/time.ts';
import type {
  CanonicalMetric,
  MetricPoint,
} from '#src/webapp/integrations/providers/core/types.ts';
import { PosthogConfig } from './config.ts';
import { POSTHOG_METRICS } from './metrics.ts';
import { PosthogSecret } from './secret.ts';

const ONE_DAY_MS = 86_400_000;
// The /query endpoint has a small hourly budget (~120/hr per personal API key);
// 10/min spacing keeps a 4-metric sync fast while staying far under the budget.
const POSTHOG_REQUESTS_PER_MINUTE = 10;
const DATE_LENGTH = 10;
const DATETIME_LENGTH = 19;

// HogQLQuery responses return rows as positional arrays: [bucket, value].
const PosthogQueryResponse = z.object({
  results: z.array(z.tuple([z.string(), z.number().nullable()])),
});

// 'YYYY-MM-DD HH:MM:SS' (UTC) for HogQL toDateTime().
const toDateTimeUtc = (ms: number): string =>
  new Date(ms).toISOString().slice(0, DATETIME_LENGTH).replace('T', ' ');

export const createPosthogAdapter = (deps: AdapterDeps = {}): MetricSourceAdapter => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = new RateLimiter({ requestsPerMinute: POSTHOG_REQUESTS_PER_MINUTE });

  const capabilities = (): ProviderCapabilities => ({
    granularities: ['day'],
    // Events can arrive late (batched SDKs, mobile flushes): re-pull a trailing
    // day each run so partial/late buckets settle.
    dataLagDays: 1,
    supportsDimensions: false,
    recommendedCadence: 'hourly',
  });

  const catalog = (): CanonicalMetric[] =>
    Object.keys(POSTHOG_METRICS).map(
      (key) => CANONICAL_METRICS[key as keyof typeof CANONICAL_METRICS],
    );

  const fetchTimeSeries: MetricSourceAdapter['fetchTimeSeries'] = async (args) => {
    const mapping = POSTHOG_METRICS[args.metricKey];
    if (!mapping) {
      throw permanentError(`PostHog does not support metric ${args.metricKey}`);
    }
    if (args.granularity !== 'day') {
      throw permanentError(`PostHog adapter only supports day granularity`);
    }
    const config = parseConfig(PosthogConfig, args.config);
    const secret = parseSecret(PosthogSecret, args.secret);

    // Filters are either fixed SQL or schema-validated identifiers (projectId is
    // numeric, hostFilter is hostname-charset) — safe to interpolate.
    const filters = [
      `timestamp >= toDateTime('${toDateTimeUtc(args.start)}')`,
      `timestamp < toDateTime('${toDateTimeUtc(args.end)}')`,
    ];
    if (mapping.pageviewOnly) {
      filters.push(`event = '$pageview'`);
    }
    if (config.hostFilter) {
      filters.push(`properties.$host = '${config.hostFilter}'`);
    }
    const query = [
      `SELECT toStartOfDay(timestamp) AS bucket, ${mapping.select} AS value`,
      'FROM events',
      `WHERE ${filters.join(' AND ')}`,
      'GROUP BY bucket',
      'ORDER BY bucket',
    ].join(' ');

    await limiter.acquire();
    const base = config.host.replace(/\/+$/, '');
    const raw = await httpJson(fetchImpl, `${base}/api/projects/${config.projectId}/query/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: args.signal,
    });

    const parsed = PosthogQueryResponse.parse(raw);
    const points: MetricPoint[] = parsed.results.map(([bucket, value]) => ({
      metricKey: args.metricKey,
      granularity: args.granularity,
      bucketTs: fromDateStringUtc(bucket.slice(0, DATE_LENGTH)),
      value: value ?? 0,
    }));

    const watermark = points.reduce((max, point) => Math.max(max, point.bucketTs), 0);
    return {
      points,
      nextCursor: null,
      watermark: watermark || undefined,
    } satisfies FetchTimeSeriesResult;
  };

  return {
    providerId: 'posthog',
    catalog,
    capabilities,
    validateConnection: async ({ config, secret, signal }): Promise<ConnectionValidation> => {
      const end = Date.now();
      try {
        await fetchTimeSeries({
          config,
          secret,
          signal,
          metricKey: 'visitors',
          granularity: 'day',
          start: end - ONE_DAY_MS,
          end,
        });
        return { ok: true };
      } catch (error) {
        const reason =
          error instanceof ProviderError
            ? error.message
            : 'Unknown error validating PostHog connection';
        return { ok: false, reason };
      }
    },
    fetchTimeSeries,
  };
};
