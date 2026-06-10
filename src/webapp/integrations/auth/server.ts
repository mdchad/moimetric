import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { drizzle } from 'drizzle-orm/libsql';
import { provisionUserWorkspace } from '#src/webapp/data/workspace.ts';
import { getTursoClient } from '#src/webapp/integrations/turso/client.ts';
import * as schema from '#src/webapp/integrations/turso/schema.ts';

const DEFAULT_BASE_URL = 'http://localhost:3000';

// Lazy async singleton: Turso credentials load asynchronously (Secrets Manager in
// prod), so the auth instance is built on first use and cached.
const createAuth = async () => {
  const client = await getTursoClient();
  const db = drizzle(client, { schema });

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? DEFAULT_BASE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await provisionUserWorkspace(user.id, user.name || user.email);
          },
        },
      },
    },
    plugins: [tanstackStartCookies()],
  });
};

type Auth = Awaited<ReturnType<typeof createAuth>>;
let authPromise: Promise<Auth> | undefined;

export const getAuth = (): Promise<Auth> => {
  if (!authPromise) {
    authPromise = createAuth();
  }
  return authPromise;
};
