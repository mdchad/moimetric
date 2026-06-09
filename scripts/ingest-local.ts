import { count } from 'drizzle-orm';
import { runIngestion } from '#src/webapp/data/ingest.ts';
import { createPlausibleAdapter } from '#src/webapp/integrations/providers/plausible/index.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import {
  DEV_CHART_ID,
  DEV_CONNECTION_ID,
  DEV_DASHBOARD_ID,
  DEV_ORG_ID,
  DEV_ORG_SLUG,
  DEV_PRODUCT_ID,
  DEV_PRODUCT_SLUG,
} from '#src/webapp/integrations/turso/dev-ids.ts';
import {
  charts,
  dashboards,
  metricPoints,
  organizations,
  products,
  sourceConnections,
} from '#src/webapp/integrations/turso/schema.ts';

const ONE_DAY_MS = 86_400_000;
const BACKFILL_DAYS = 30;
const FIXTURE_BASE = 100;
const FIXTURE_SPREAD = 50;

// Fixture fetch: synthesizes a deterministic daily Plausible response for the
// requested window, so the full adapter -> ingestion -> upsert path runs without
// real Plausible credentials. Re-running yields identical values (idempotent).
const fixtureFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const [from, to] = body.date_range as [string, string];
  const results: Array<{ metrics: number[]; dimensions: string[] }> = [];
  for (
    let ts = Date.parse(`${from}T00:00:00Z`);
    ts <= Date.parse(`${to}T00:00:00Z`);
    ts += ONE_DAY_MS
  ) {
    const dayIndex = Math.floor(ts / ONE_DAY_MS);
    results.push({
      metrics: [FIXTURE_BASE + (dayIndex % FIXTURE_SPREAD)],
      dimensions: [new Date(ts).toISOString().slice(0, 10)],
    });
  }
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const seedFixtures = async (
  db: Awaited<ReturnType<typeof getDb>>,
  providerConfig: unknown,
): Promise<void> => {
  await db
    .insert(organizations)
    .values({ id: DEV_ORG_ID, name: 'Dev Org', slug: DEV_ORG_SLUG })
    .onConflictDoNothing();
  await db
    .insert(products)
    .values({ id: DEV_PRODUCT_ID, orgId: DEV_ORG_ID, name: 'Demo App', slug: DEV_PRODUCT_SLUG })
    .onConflictDoNothing();
  await db
    .insert(dashboards)
    .values({ id: DEV_DASHBOARD_ID, productId: DEV_PRODUCT_ID, name: 'Overview', isDefault: 1 })
    .onConflictDoNothing();
  await db
    .insert(sourceConnections)
    .values({
      id: DEV_CONNECTION_ID,
      productId: DEV_PRODUCT_ID,
      provider: 'plausible',
      providerConfig: JSON.stringify(providerConfig),
      status: 'active',
    })
    .onConflictDoNothing();
  await db
    .insert(charts)
    .values({
      id: DEV_CHART_ID,
      dashboardId: DEV_DASHBOARD_ID,
      connectionId: DEV_CONNECTION_ID,
      metricKey: 'pageviews',
      title: 'Pageviews',
      vizConfig: JSON.stringify({ type: 'area' }),
      sortOrder: 0,
    })
    .onConflictDoNothing();
};

const main = async (): Promise<void> => {
  const db = await getDb();

  const realKey = process.env.PLAUSIBLE_API_KEY;
  const realSite = process.env.PLAUSIBLE_SITE_ID;
  const useReal = Boolean(realKey && realSite);

  const config = { siteId: realSite ?? 'demo.example.com' };
  const secret = { apiKey: realKey ?? 'fixture-key' };
  const adapter = createPlausibleAdapter(useReal ? {} : { fetchImpl: fixtureFetch });

  await seedFixtures(db, config);

  const before = await db.select({ value: count() }).from(metricPoints);
  const end = Date.now();
  const result = await runIngestion(db, {
    connectionId: DEV_CONNECTION_ID,
    adapter,
    config,
    secret,
    metricKeys: ['pageviews', 'visitors'],
    granularity: 'day',
    start: end - BACKFILL_DAYS * ONE_DAY_MS,
    end,
    kind: 'backfill',
  });
  const after = await db.select({ value: count() }).from(metricPoints);

  // oxlint-disable-next-line no-console
  console.log(
    `Mode: ${useReal ? 'real Plausible' : 'fixture'} | rows written: ${result.rowsWritten} | metric_points: ${before[0].value} -> ${after[0].value} | cursor: ${result.cursorAfter}`,
  );
};

try {
  await main();
  process.exit(0);
} catch (error) {
  // oxlint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
