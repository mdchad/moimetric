import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { type Client, createClient } from '@libsql/client/web';
import { z } from 'zod';

// Turso (libSQL) credentials. In AWS the Lambda reads them from a per-stage
// Secrets Manager secret (moimetric/<stage>/turso) referenced by TURSO_SECRET_ARN.
// For local dev you can instead set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN directly.
const tursoCredentialsSchema = z.object({
  url: z.string().min(1),
  authToken: z.string().min(1),
});

type TursoCredentials = z.infer<typeof tursoCredentialsSchema>;

let clientPromise: Promise<Client> | undefined;
let secretsManager: SecretsManagerClient | undefined;

const getSecretsManager = (): SecretsManagerClient => {
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  return secretsManager;
};

const loadCredentials = async (): Promise<TursoCredentials> => {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (url && authToken) {
    return tursoCredentialsSchema.parse({ url, authToken });
  }

  const secretArn = process.env.TURSO_SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      'Turso credentials not configured: set TURSO_SECRET_ARN, or TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.',
    );
  }

  const response = await getSecretsManager().send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!response.SecretString) {
    throw new Error('Turso secret has no SecretString value.');
  }

  return tursoCredentialsSchema.parse(JSON.parse(response.SecretString));
};

// Cached libSQL client. Reused across warm Lambda invocations.
export const getTursoClient = (): Promise<Client> => {
  if (!clientPromise) {
    clientPromise = loadCredentials().then((credentials) =>
      createClient({ url: credentials.url, authToken: credentials.authToken }),
    );
  }
  return clientPromise;
};
