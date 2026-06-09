import { expect, test } from 'vite-plus/test';
import { createPlausibleAdapter } from './index.ts';

const JUN_01 = Date.parse('2026-06-01T00:00:00Z');
const JUN_02 = Date.parse('2026-06-02T00:00:00Z');
const JUN_03 = Date.parse('2026-06-03T00:00:00Z');

const jsonFetch =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = { siteId: 'example.com' };
const secret = { apiKey: 'test-key' };

test('plausible normalizes a daily pageviews series', async () => {
  const adapter = createPlausibleAdapter({
    fetchImpl: jsonFetch({
      results: [
        { metrics: [10], dimensions: ['2026-06-01'] },
        { metrics: [20], dimensions: ['2026-06-02'] },
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

test('plausible converts bounce_rate percentage to a 0..1 ratio', async () => {
  const adapter = createPlausibleAdapter({
    fetchImpl: jsonFetch({ results: [{ metrics: [45], dimensions: ['2026-06-01'] }] }),
  });

  const result = await adapter.fetchTimeSeries({
    config,
    secret,
    metricKey: 'bounce_rate',
    granularity: 'day',
    start: JUN_01,
    end: JUN_02,
  });

  expect(result.points[0].value).toBeCloseTo(0.45);
});

test('plausible validateConnection reports auth failure', async () => {
  const adapter = createPlausibleAdapter({ fetchImpl: jsonFetch({ error: 'nope' }, 401) });
  const result = await adapter.validateConnection({ config, secret });
  expect(result.ok).toBe(false);
});
