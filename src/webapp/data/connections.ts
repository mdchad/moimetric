import { CreateSecretCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createServerFn } from '@tanstack/react-start';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';
import { getAdapter } from '#src/webapp/integrations/providers/core/registry.ts';
import { ProviderId } from '#src/webapp/integrations/providers/core/types.ts';
import { getDb } from '#src/webapp/integrations/turso/db.ts';
import { sourceConnections } from '#src/webapp/integrations/turso/schema.ts';

// NOTE: tenant scoping deferred until better-auth lands (see data/metrics.ts).

let secretsManager: SecretsManagerClient | undefined;
const getSecretsManager = (): SecretsManagerClient => {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
};

const currentStage = (): string => process.env.APP_STAGE ?? 'dev';

const CreateConnectionInput = z.object({
  productId: z.string().min(1),
  provider: ProviderId,
  config: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.unknown()),
});

// Validates the credentials against the live provider, stores them in a
// per-connection Secrets Manager secret, and records the connection. The
// ingestion worker later reads that secret by ARN.
export const createConnection = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => CreateConnectionInput.parse(data))
  .handler(async ({ data }): Promise<{ id: string; status: 'active' }> => {
    const adapter = getAdapter(data.provider);
    const validation = await adapter.validateConnection({
      config: data.config,
      secret: data.secret,
    });
    if (!validation.ok) {
      throw new Error(`Connection validation failed: ${validation.reason}`);
    }

    const id = ulid();
    const secretName = `moimetric/${currentStage()}/connections/${id}`;
    const created = await getSecretsManager().send(
      new CreateSecretCommand({ Name: secretName, SecretString: JSON.stringify(data.secret) }),
    );

    const db = await getDb();
    await db.insert(sourceConnections).values({
      id,
      productId: data.productId,
      provider: data.provider,
      credSecretArn: created.ARN,
      providerConfig: JSON.stringify(data.config),
      status: 'active',
    });

    return { id, status: 'active' };
  });

export const listConnections = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({ productId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const db = await getDb();
    return db
      .select({
        id: sourceConnections.id,
        provider: sourceConnections.provider,
        status: sourceConnections.status,
        lastSyncedAt: sourceConnections.lastSyncedAt,
      })
      .from(sourceConnections)
      .where(eq(sourceConnections.productId, data.productId))
      .orderBy(asc(sourceConnections.createdAt));
  });
