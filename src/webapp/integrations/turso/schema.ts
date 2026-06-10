import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Multi-tenant metrics dashboard schema (Turso / libSQL via Drizzle).
// IDs are ULIDs (k-sortable). Timestamps are epoch milliseconds (integer).
// Currency values are stored as integer minor units; ratios as 0..1.

const now = sql`(unixepoch() * 1000)`;

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at').notNull().default(now),
});

// Identity tables owned by better-auth (model -> table mapped in integrations/auth/server.ts).
// Property keys must match better-auth's field names; date columns use timestamp mode.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'viewer'] }).notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('products_org_slug_uq').on(t.orgId, t.slug),
    index('products_org_idx').on(t.orgId),
  ],
);

export const sourceConnections = sqliteTable(
  'source_connections',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    credSecretArn: text('cred_secret_arn'),
    providerConfig: text('provider_config').notNull().default('{}'),
    status: text('status', { enum: ['pending', 'active', 'error', 'disabled'] })
      .notNull()
      .default('pending'),
    incrementalCursor: text('incremental_cursor'),
    lastSyncedAt: integer('last_synced_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('source_connections_product_idx').on(t.productId),
    index('source_connections_status_idx').on(t.status, t.provider),
  ],
);

// Hot table. Composite PK is the idempotency key for upserts AND the range-scan
// index for the dominant chart query. Declared WITHOUT ROWID in the migration so
// the PK is the physical clustering order (see drizzle/ migration).
export const metricPoints = sqliteTable(
  'metric_points',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => sourceConnections.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    granularity: text('granularity', { enum: ['day', 'week', 'month'] }).notNull(),
    bucketTs: integer('bucket_ts').notNull(),
    value: real('value').notNull(),
    dims: text('dims').notNull().default(''),
    dimsHash: text('dims_hash').notNull().default(''),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.metricKey, t.granularity, t.bucketTs, t.dimsHash] }),
  ],
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => sourceConnections.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['backfill', 'incremental'] }).notNull(),
    startedAt: integer('started_at').notNull().default(now),
    finishedAt: integer('finished_at'),
    status: text('status', { enum: ['running', 'success', 'partial', 'error'] }).notNull(),
    cursorBefore: text('cursor_before'),
    cursorAfter: text('cursor_after'),
    rowsWritten: integer('rows_written').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('sync_runs_connection_idx').on(t.connectionId, t.startedAt)],
);

export const dashboards = sqliteTable(
  'dashboards',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: integer('is_default').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('dashboards_product_idx').on(t.productId)],
);

export const charts = sqliteTable(
  'charts',
  {
    id: text('id').primaryKey(),
    dashboardId: text('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => sourceConnections.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    title: text('title').notNull(),
    vizConfig: text('viz_config').notNull().default('{}'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('charts_dashboard_idx').on(t.dashboardId)],
);

// Tiny example retained as a working Turso reference (replaces the DynamoDB todos demo).
export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
});
