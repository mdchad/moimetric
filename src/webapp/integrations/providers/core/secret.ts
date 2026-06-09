import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { z } from 'zod';
import { authError, transientError } from './errors.ts';

// Generic per-connection secret loader. Mirrors integrations/turso/client.ts:
// reads a Secrets Manager secret by ARN and validates it with the provider's
// Zod secret schema. Each connection's secret lives at
// moimetric/<stage>/connections/<connectionId>.
let secretsManager: SecretsManagerClient | undefined;

const getSecretsManager = (): SecretsManagerClient => {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
};

export const loadConnectionSecret = async <TSchema extends z.ZodTypeAny>(
  secretArn: string,
  schema: TSchema,
): Promise<z.infer<TSchema>> => {
  let secretString: string | undefined;
  try {
    const response = await getSecretsManager().send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    secretString = response.SecretString;
  } catch (error) {
    throw transientError(`Failed to read connection secret ${secretArn}`, error);
  }
  if (!secretString) {
    throw authError(`Connection secret ${secretArn} has no value`);
  }
  const parsed = schema.safeParse(JSON.parse(secretString));
  if (!parsed.success) {
    throw authError(`Connection secret ${secretArn} failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
};
