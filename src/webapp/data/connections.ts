import { CreateSecretCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createServerFn } from '@tanstack/react-start';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';
import { requireUserWorkspace } from '#src/webapp/data/session.server.ts';
import { requestConnectionSync } from '#src/webapp/data/sync-trigger.ts';
import { getAdapter } from '#src/webapp/integrations/providers/core/registry.ts';
import { CanonicalMetricKey, ProviderId } from '#src/webapp/integrations/providers/core/types.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { charts, sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

const DEFAULT_CHART_COUNT = 2;
const MAX_CHART_METRICS = 4;

let secretsManager: SecretsManagerClient | undefined;
const getSecretsManager = (): SecretsManagerClient => {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
};

const currentStage = (): string => process.env.APP_STAGE ?? 'dev';

// productId is NEVER taken from the client — it resolves from the session
// workspace (requireUserWorkspace). The label names the connection's charts.
const CreateConnectionInput = z.object({
  provider: ProviderId,
  label: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.unknown()),
  chartMetrics: z.array(CanonicalMetricKey).min(1).max(MAX_CHART_METRICS).optional(),
});

// Validates the credentials against the live provider, stores them in a
// per-connection Secrets Manager secret, records the connection, creates its
// default dashboard charts, and kicks off the first sync (queued when deployed,
// inline in local dev — same single write path as the scheduler).
export const createConnection = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => CreateConnectionInput.parse(data))
  .handler(async ({ data }): Promise<{ id: string; status: 'active' }> => {
    const { productId, dashboardId } = await requireUserWorkspace();

    const adapter = getAdapter(data.provider);
    const validation = await adapter.validateConnection({
      config: data.config,
      secret: data.secret,
    });
    if (!validation.ok) {
      throw new Error(`Connection validation failed: ${validation.reason}`);
    }

    const catalog = adapter.catalog();
    const chartMetrics = data.chartMetrics ?? [];
    const supported = new Set(catalog.map((metric) => metric.key));
    for (const metricKey of chartMetrics) {
      if (!supported.has(metricKey)) {
        throw new Error(`Metric ${metricKey} is not supported by ${data.provider}`);
      }
    }
    const chartEntries = (
      chartMetrics.length > 0
        ? catalog.filter((metric) => chartMetrics.includes(metric.key))
        : catalog.slice(0, DEFAULT_CHART_COUNT)
    ).map((metric) => ({ metricKey: metric.key, label: metric.label }));

    const id = ulid();
    const secretName = `moimetric/${currentStage()}/connections/${id}`;
    const created = await getSecretsManager().send(
      new CreateSecretCommand({ Name: secretName, SecretString: JSON.stringify(data.secret) }),
    );

    const db = await getDb();
    await db.insert(sourceConnections).values({
      id,
      productId,
      provider: data.provider,
      credSecretArn: created.ARN,
      providerConfig: JSON.stringify(data.config),
      status: 'active',
    });

    let sortOrder = 0;
    for (const entry of chartEntries) {
      // oxlint-disable-next-line no-await-in-loop
      await db
        .insert(charts)
        .values({
          id: `chart-${id}-${entry.metricKey}`,
          dashboardId,
          connectionId: id,
          metricKey: entry.metricKey,
          title: `${data.label} · ${entry.label}`,
          vizConfig: JSON.stringify({ type: 'area' }),
          sortOrder,
        })
        .onConflictDoNothing();
      sortOrder += 1;
    }

    // First sync starts immediately; a failure here must not fail the connect —
    // the hourly schedule will catch up.
    try {
      await requestConnectionSync([id]);
    } catch (error) {
      console.error('auto-sync after connection create failed', String(error));
    }

    return { id, status: 'active' };
  });

export const listConnections = createServerFn({ method: 'POST' }).handler(async () => {
  const { productId } = await requireUserWorkspace();
  const db = await getDb();
  return db
    .select({
      id: sourceConnections.id,
      provider: sourceConnections.provider,
      status: sourceConnections.status,
      lastSyncedAt: sourceConnections.lastSyncedAt,
    })
    .from(sourceConnections)
    .where(eq(sourceConnections.productId, productId))
    .orderBy(asc(sourceConnections.createdAt));
});
