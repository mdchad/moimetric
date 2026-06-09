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
  Granularity,
  MetricPoint,
} from '#src/webapp/integrations/providers/core/types.ts';
import { FathomConfig } from './config.ts';
import { FATHOM_METRICS } from './metrics.ts';
import { FathomSecret } from './secret.ts';

const ONE_DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 180; // Fathom caps day-grouping windows at ~6 months
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * ONE_DAY_MS;
const FATHOM_REQUESTS_PER_MINUTE = 10; // strict reporting budget

const FathomResponse = z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])));

const dateGroupingFor = (granularity: Granularity): string => {
  if (granularity === 'day') {
    return 'day';
  }
  if (granularity === 'month') {
    return 'month';
  }
  throw permanentError(`Fathom does not support granularity ${granularity}`);
};

// Split [start, end) into <= MAX_WINDOW_MS sub-windows.
const windows = (start: number, end: number): Array<[number, number]> => {
  const result: Array<[number, number]> = [];
  for (let from = start; from < end; from += MAX_WINDOW_MS) {
    result.push([from, Math.min(from + MAX_WINDOW_MS, end)]);
  }
  return result;
};

export const createFathomAdapter = (deps: AdapterDeps = {}): MetricSourceAdapter => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = new RateLimiter({ requestsPerMinute: FATHOM_REQUESTS_PER_MINUTE });

  const capabilities = (): ProviderCapabilities => ({
    granularities: ['day', 'month'],
    maxWindowDays: MAX_WINDOW_DAYS,
    dataLagDays: 0,
    supportsDimensions: false,
    recommendedCadence: 'daily',
  });

  const catalog = (): CanonicalMetric[] =>
    Object.keys(FATHOM_METRICS).map(
      (key) => CANONICAL_METRICS[key as keyof typeof CANONICAL_METRICS],
    );

  const fetchTimeSeries: MetricSourceAdapter['fetchTimeSeries'] = async (args) => {
    const mapping = FATHOM_METRICS[args.metricKey];
    if (!mapping) {
      throw permanentError(`Fathom does not support metric ${args.metricKey}`);
    }
    const config = parseConfig(FathomConfig, args.config);
    const secret = parseSecret(FathomSecret, args.secret);
    const dateGrouping = dateGroupingFor(args.granularity);
    const points: MetricPoint[] = [];

    // Sequential by design: each request must pass through the rate limiter,
    // so parallelizing would violate Fathom's strict reporting budget.
    for (const [from, to] of windows(args.start, args.end)) {
      // oxlint-disable-next-line no-await-in-loop
      await limiter.acquire();
      const params = new URLSearchParams({
        entity: 'pageviews',
        entity_id: config.entityId,
        aggregates: mapping.aggregate,
        date_grouping: dateGrouping,
        date_from: toDateStringUtc(from),
        date_to: toDateStringUtc(to - ONE_DAY_MS),
        sort_by: 'timestamp:asc',
        timezone: 'UTC',
      });
      // oxlint-disable-next-line no-await-in-loop
      const raw = await httpJson(
        fetchImpl,
        `${config.baseUrl}/v1/aggregations?${params.toString()}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${secret.apiToken}` },
          signal: args.signal,
        },
      );
      for (const row of FathomResponse.parse(raw)) {
        const dateValue = row.date;
        if (typeof dateValue !== 'string') {
          continue;
        }
        points.push({
          metricKey: args.metricKey,
          granularity: args.granularity,
          bucketTs: fromDateStringUtc(dateValue.slice(0, 10)),
          value: mapping.toValue(Number(row[mapping.aggregate] ?? 0)),
        });
      }
    }

    const watermark = points.reduce((max, point) => Math.max(max, point.bucketTs), 0);
    return {
      points,
      nextCursor: null,
      watermark: watermark || undefined,
    } satisfies FetchTimeSeriesResult;
  };

  return {
    providerId: 'fathom',
    catalog,
    capabilities,
    validateConnection: async ({ config, secret, signal }): Promise<ConnectionValidation> => {
      const end = Date.now();
      try {
        await fetchTimeSeries({
          config,
          secret,
          signal,
          metricKey: 'pageviews',
          granularity: 'day',
          start: end - ONE_DAY_MS,
          end,
        });
        return { ok: true };
      } catch (error) {
        const reason =
          error instanceof ProviderError
            ? error.message
            : 'Unknown error validating Fathom connection';
        return { ok: false, reason };
      }
    },
    fetchTimeSeries,
  };
};
