import { expect, test } from 'vite-plus/test';
import { createFathomAdapter } from './index.ts';

const JUN_01 = Date.parse('2026-06-01T00:00:00Z');
const JUN_02 = Date.parse('2026-06-02T00:00:00Z');
const JUN_03 = Date.parse('2026-06-03T00:00:00Z');

const jsonFetch =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = { entityId: 'ABCDEF' };
const secret = { apiToken: 'test-token' };

test('fathom normalizes a daily pageviews series', async () => {
  const adapter = createFathomAdapter({
    fetchImpl: jsonFetch([
      { date: '2026-06-01 00:00:00', pageviews: '10' },
      { date: '2026-06-02 00:00:00', pageviews: '20' },
    ]),
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
});

test('fathom validateConnection reports auth failure', async () => {
  const adapter = createFathomAdapter({ fetchImpl: jsonFetch({ error: 'nope' }, 403) });
  const result = await adapter.validateConnection({ config, secret });
  expect(result.ok).toBe(false);
});
