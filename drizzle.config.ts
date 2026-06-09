import { defineConfig } from 'drizzle-kit';

// Migrations are generated from the Drizzle schema and applied out-of-band
// (CI / local) against each stage's Turso database — same as the Turso secret
// is provisioned out-of-band from CDK.
const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  throw new Error('TURSO_DATABASE_URL is required to run drizzle-kit');
}

export default defineConfig({
  dialect: 'turso',
  schema: './src/webapp/integrations/turso/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
