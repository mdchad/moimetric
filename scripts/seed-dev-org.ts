import { getDb } from '#src/webapp/integrations/turso/db.ts';
import {
  DEV_DASHBOARD_ID,
  DEV_ORG_ID,
  DEV_ORG_SLUG,
  DEV_PRODUCT_ID,
  DEV_PRODUCT_SLUG,
} from '#src/webapp/integrations/turso/dev-ids.ts';
import { dashboards, organizations, products } from '#src/webapp/integrations/turso/schema.ts';

// Seeds the single dev org/product/dashboard used while auth is not yet built.
// Idempotent: re-running inserts nothing new.
const seed = async (): Promise<void> => {
  const db = await getDb();

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

  const orgs = await db.select().from(organizations);
  // oxlint-disable-next-line no-console
  console.log('Seeded. organizations:', orgs);
};

try {
  await seed();
  process.exit(0);
} catch (error) {
  // oxlint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
