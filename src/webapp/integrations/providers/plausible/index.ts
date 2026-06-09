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
import {
  fromDateStringUtc,
  toDateStringUtc,
} from '#src/webapp/integrations/providers/core/time.ts';
import type {
  CanonicalMetric,
  MetricPoint,
} from '#src/webapp/integrations/providers/core/types.ts';
import { PlausibleConfig } from './config.ts';
import { PLAUSIBLE_METRICS } from './metrics.ts';
import { PlausibleSecret } from './secret.ts';

const ONE_DAY_MS = 86_400_000;
const PLAUSIBLE_REQUESTS_PER_MINUTE = 10; // ~600/hr documented budget

const PlausibleResponse = z.object({
  results: z.array(
    z.object({
      metrics: z.array(z.number().nullable()),
      dimensions: z.array(z.string()),
    }),
  ),
});

export const createPlausibleAdapter = (deps: AdapterDeps = {}): MetricSourceAdapter => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = new RateLimiter({ requestsPerMinute: PLAUSIBLE_REQUESTS_PER_MINUTE });

  const capabilities = (): ProviderCapabilities => ({
    granularities: ['day', 'week', 'month'],
    dataLagDays: 0,
    supportsDimensions: false,
    recommendedCadence: 'hourly',
  });

  const catalog = (): CanonicalMetric[] =>
    Object.keys(PLAUSIBLE_METRICS).map(
      (key) => CANONICAL_METRICS[key as keyof typeof CANONICAL_METRICS],
    );

  const fetchTimeSeries: MetricSourceAdapter['fetchTimeSeries'] = async (args) => {
    const mapping = PLAUSIBLE_METRICS[args.metricKey];
    if (!mapping) {
      throw permanentError(`Plausible does not support metric ${args.metricKey}`);
    }
    const config = parseConfig(PlausibleConfig, args.config);
    const secret = parseSecret(PlausibleSecret, args.secret);

    await limiter.acquire();
    const fromDate = toDateStringUtc(args.start);
    const toDate = toDateStringUtc(args.end - ONE_DAY_MS); // end is exclusive
    const raw = await httpJson(fetchImpl, `${config.baseUrl}/api/v2/query`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: config.siteId,
        metrics: [mapping.native],
        date_range: [fromDate, toDate],
        dimensions: [`time:${args.granularity}`],
      }),
      signal: args.signal,
    });

    const parsed = PlausibleResponse.parse(raw);
    const points: MetricPoint[] = parsed.results.map((row) => ({
      metricKey: args.metricKey,
      granularity: args.granularity,
      bucketTs: fromDateStringUtc(row.dimensions[0]),
      value: mapping.toValue(row.metrics[0] ?? 0),
    }));

    const watermark = points.reduce((max, point) => Math.max(max, point.bucketTs), 0);
    return {
      points,
      nextCursor: null,
      watermark: watermark || undefined,
    } satisfies FetchTimeSeriesResult;
  };

  return {
    providerId: 'plausible',
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
            : 'Unknown error validating Plausible connection';
        return { ok: false, reason };
      }
    },
    fetchTimeSeries,
  };
};
