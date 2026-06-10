import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import {
  dashboards,
  memberships,
  organizations,
  products,
} from '#src/webapp/integrations/turso/schema.ts';

export interface Workspace {
  orgId: string;
  productId: string;
  dashboardId: string;
}

// The user's default org → product → dashboard (single-product for now).
export const resolveUserWorkspace = async (userId: string): Promise<Workspace | null> => {
  const db = await getDb();
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!membership) {
    return null;
  }
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.orgId, membership.orgId))
    .limit(1);
  if (!product) {
    return null;
  }
  const [dashboard] = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.productId, product.id))
    .limit(1);
  if (!dashboard) {
    return null;
  }
  return { orgId: membership.orgId, productId: product.id, dashboardId: dashboard.id };
};

// Provisions org + owner membership + default product + dashboard for a new user.
// Idempotent — called from better-auth's user-create hook.
export const provisionUserWorkspace = async (
  userId: string,
  displayName: string,
): Promise<Workspace> => {
  const existing = await resolveUserWorkspace(userId);
  if (existing) {
    return existing;
  }
  const db = await getDb();
  const orgId = ulid();
  const productId = ulid();
  const dashboardId = ulid();

  await db
    .insert(organizations)
    .values({ id: orgId, name: `${displayName}'s workspace`, slug: orgId });
  await db.insert(memberships).values({ id: ulid(), orgId, userId, role: 'owner' });
  await db.insert(products).values({ id: productId, orgId, name: 'My Product', slug: 'default' });
  await db
    .insert(dashboards)
    .values({ id: dashboardId, productId, name: 'Overview', isDefault: 1 });

  return { orgId, productId, dashboardId };
};
