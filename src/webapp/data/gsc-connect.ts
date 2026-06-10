import {
  CreateSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { sql } from 'drizzle-orm';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { charts, sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

let secretsManager: SecretsManagerClient | undefined;
const getSecretsManager = (): SecretsManagerClient => {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
};

const currentStage = (): string => process.env.APP_STAGE ?? 'dev';
const slug = (value: string): string => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');

// One secret per (product) Google grant; all of that account's properties share it.
const upsertGrantSecret = async (
  productId: string,
  value: { refreshToken: string; clientId: string; clientSecret: string },
): Promise<string> => {
  const name = `moimetric/${currentStage()}/connections/gsc-${productId}`;
  const secretString = JSON.stringify(value);
  try {
    await getSecretsManager().send(
      new CreateSecretCommand({ Name: name, SecretString: secretString }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ResourceExistsException') {
      await getSecretsManager().send(
        new PutSecretValueCommand({ SecretId: name, SecretString: secretString }),
      );
    } else {
      throw error;
    }
  }
  return name; // SecretId by name works for GetSecretValue
};

// Charts auto-created per property so the dashboard shows data immediately.
const DEFAULT_CHART_METRICS = [
  { metricKey: 'clicks', label: 'Clicks' },
  { metricKey: 'impressions', label: 'Impressions' },
] as const;

export interface ConnectGscArgs {
  productId: string;
  dashboardId: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  siteUrls: string[];
}

export const connectGscProperties = async (
  args: ConnectGscArgs,
): Promise<{ connected: number; connectionIds: string[] }> => {
  const credSecretArn = await upsertGrantSecret(args.productId, {
    refreshToken: args.refreshToken,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });

  const db = await getDb();
  const connectionIds: string[] = [];
  let sortOrder = 0;
  for (const siteUrl of args.siteUrls) {
    const connectionId = `gsc-${args.productId}-${slug(siteUrl)}`;
    connectionIds.push(connectionId);
    // oxlint-disable-next-line no-await-in-loop
    await db
      .insert(sourceConnections)
      .values({
        id: connectionId,
        productId: args.productId,
        provider: 'gsc',
        credSecretArn,
        providerConfig: JSON.stringify({ siteUrl }),
        status: 'active',
      })
      .onConflictDoUpdate({
        target: sourceConnections.id,
        set: { credSecretArn, providerConfig: sql`excluded.provider_config`, status: 'active' },
      });

    for (const metric of DEFAULT_CHART_METRICS) {
      // oxlint-disable-next-line no-await-in-loop
      await db
        .insert(charts)
        .values({
          id: `chart-${connectionId}-${metric.metricKey}`,
          dashboardId: args.dashboardId,
          connectionId,
          metricKey: metric.metricKey,
          title: `${siteUrl} · ${metric.label}`,
          vizConfig: JSON.stringify({ type: 'area' }),
          sortOrder,
        })
        .onConflictDoNothing();
      sortOrder += 1;
    }
  }

  return { connected: args.siteUrls.length, connectionIds };
};
