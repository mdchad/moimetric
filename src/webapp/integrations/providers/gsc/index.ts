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
import { GscConfig } from './config.ts';
import { GSC_METRICS } from './metrics.ts';
import { GscSecret } from './secret.ts';

const ONE_DAY_MS = 86_400_000;
const TOKEN_SKEW_MS = 60_000;
const ROW_LIMIT = 25_000;
const GSC_REQUESTS_PER_MINUTE = 60;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

const GscRow = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
const GscResponse = z.object({ rows: z.array(GscRow).optional() });
type GscRow = z.infer<typeof GscRow>;

export const createGscAdapter = (deps: AdapterDeps = {}): MetricSourceAdapter => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = new RateLimiter({ requestsPerMinute: GSC_REQUESTS_PER_MINUTE });
  // Per-instance caches: one access token per grant, one searchAnalytics response
  // per (site, window) so the four canonical metrics share a single HTTP query.
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();
  const rowsCache = new Map<string, Promise<GscRow[]>>();

  const refreshAccessToken = async (secret: GscSecret): Promise<string> => {
    const cached = tokenCache.get(secret.refreshToken);
    if (cached && cached.expiresAt > Date.now() + TOKEN_SKEW_MS) {
      return cached.token;
    }
    const body = new URLSearchParams({
      client_id: secret.clientId,
      client_secret: secret.clientSecret,
      refresh_token: secret.refreshToken,
      grant_type: 'refresh_token',
    });
    const raw = await httpJson(fetchImpl, TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const parsed = TokenResponse.parse(raw);
    tokenCache.set(secret.refreshToken, {
      token: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    });
    return parsed.access_token;
  };

  const getRows = (
    config: GscConfig,
    secret: GscSecret,
    start: number,
    end: number,
    signal?: AbortSignal,
  ) => {
    const key = `${config.siteUrl}|${start}|${end}`;
    const existing = rowsCache.get(key);
    if (existing) {
      return existing;
    }
    const pending = (async (): Promise<GscRow[]> => {
      await limiter.acquire();
      const accessToken = await refreshAccessToken(secret);
      const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.siteUrl)}/searchAnalytics/query`;
      const raw = await httpJson(fetchImpl, url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: toDateStringUtc(start),
          endDate: toDateStringUtc(end - ONE_DAY_MS), // end exclusive; GSC end inclusive
          dimensions: ['date'],
          rowLimit: ROW_LIMIT,
          dataState: 'final',
        }),
        signal,
      });
      return GscResponse.parse(raw).rows ?? [];
    })();
    rowsCache.set(key, pending);
    return pending;
  };

  const fetchTimeSeries: MetricSourceAdapter['fetchTimeSeries'] = async (args) => {
    const field = GSC_METRICS[args.metricKey];
    if (!field) {
      throw permanentError(`GSC does not support metric ${args.metricKey}`);
    }
    if (args.granularity !== 'day') {
      throw permanentError('GSC supports day granularity only');
    }
    const config = parseConfig(GscConfig, args.config);
    const secret = parseSecret(GscSecret, args.secret);

    const rows = await getRows(config, secret, args.start, args.end, args.signal);
    const points: MetricPoint[] = rows.map((row) => ({
      metricKey: args.metricKey,
      granularity: 'day',
      bucketTs: fromDateStringUtc(row.keys[0]),
      value: row[field],
    }));

    const watermark = points.reduce((max, point) => Math.max(max, point.bucketTs), 0);
    return {
      points,
      nextCursor: null,
      watermark: watermark || undefined,
    } satisfies FetchTimeSeriesResult;
  };

  return {
    providerId: 'gsc',
    catalog: (): CanonicalMetric[] =>
      Object.keys(GSC_METRICS).map(
        (key) => CANONICAL_METRICS[key as keyof typeof CANONICAL_METRICS],
      ),
    capabilities: (): ProviderCapabilities => ({
      granularities: ['day'],
      dataLagDays: 3, // GSC data settles 2-3 days late
      supportsDimensions: false,
      recommendedCadence: 'daily',
    }),
    validateConnection: async ({ secret }): Promise<ConnectionValidation> => {
      try {
        await refreshAccessToken(parseSecret(GscSecret, secret));
        return { ok: true };
      } catch (error) {
        const reason =
          error instanceof ProviderError
            ? error.message
            : 'Unknown error validating GSC connection';
        return { ok: false, reason };
      }
    },
    fetchTimeSeries,
  };
};
