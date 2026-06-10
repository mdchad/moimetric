import { expect, test } from 'vite-plus/test';
import { createPosthogAdapter } from './index.ts';

const JUN_01 = Date.parse('2026-06-01T00:00:00Z');
const JUN_02 = Date.parse('2026-06-02T00:00:00Z');
const JUN_03 = Date.parse('2026-06-03T00:00:00Z');

const jsonFetch =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = { host: 'https://us.posthog.com', projectId: '12345' };
const secret = { apiKey: 'phx_test' };

test('posthog normalizes a daily pageviews series', async () => {
  const adapter = createPosthogAdapter({
    fetchImpl: jsonFetch({
      results: [
        ['2026-06-01T00:00:00Z', 10],
        ['2026-06-02T00:00:00Z', 20],
      ],
    }),
  });

  const result = await adapter.fetchTimeSeries({
    config,
    secret,
    metricKey: 'pageviews',
    granularity: 'day',
    start: JUN_01,
    end: JUN_03,
  });

  expect(result.points).toEqual([
    { metricKey: 'pageviews', granularity: 'day', bucketTs: JUN_01, value: 10 },
    { metricKey: 'pageviews', granularity: 'day', bucketTs: JUN_02, value: 20 },
  ]);
  expect(result.watermark).toBe(JUN_02);
  expect(result.nextCursor).toBeNull();
});

test('posthog builds a host-filtered pageview HogQL query', async () => {
  let sentBody = '';
  const adapter = createPosthogAdapter({
    fetchImpl: async (_url, init) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await adapter.fetchTimeSeries({
    config: { ...config, hostFilter: 'example.com' },
    secret,
    metricKey: 'pageviews',
    granularity: 'day',
    start: JUN_01,
    end: JUN_02,
  });

  const { query } = JSON.parse(sentBody).query as { query: string };
  expect(query).toContain(`event = '$pageview'`);
  expect(query).toContain(`properties.$host IN ('example.com', 'www.example.com')`);
  expect(query).toContain(`timestamp >= toDateTime('2026-06-01 00:00:00')`);
});

test('posthog host filter normalizes a www-prefixed input', async () => {
  let sentBody = '';
  const adapter = createPosthogAdapter({
    fetchImpl: async (_url, init) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await adapter.fetchTimeSeries({
    config: { ...config, hostFilter: 'www.example.com' },
    secret,
    metricKey: 'pageviews',
    granularity: 'day',
    start: JUN_01,
    end: JUN_02,
  });

  const { query } = JSON.parse(sentBody).query as { query: string };
  expect(query).toContain(`properties.$host IN ('example.com', 'www.example.com')`);
});

test('posthog treats null buckets as zero', async () => {
  const adapter = createPosthogAdapter({
    fetchImpl: jsonFetch({ results: [['2026-06-01T00:00:00Z', null]] }),
  });
  const result = await adapter.fetchTimeSeries({
    config,
    secret,
    metricKey: 'visitors',
    granularity: 'day',
    start: JUN_01,
    end: JUN_02,
  });
  expect(result.points[0].value).toBe(0);
});

test('posthog validateConnection reports auth failure', async () => {
  const adapter = createPosthogAdapter({ fetchImpl: jsonFetch({ detail: 'nope' }, 401) });
  const result = await adapter.validateConnection({ config, secret });
  expect(result.ok).toBe(false);
});
