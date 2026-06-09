import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { getTursoClient } from './client.ts';
import * as schema from './schema.ts';

export type Database = LibSQLDatabase<typeof schema>;

let dbPromise: Promise<Database> | undefined;

// Cached Drizzle instance over the existing secret-backed libSQL client.
export const getDb = (): Promise<Database> => {
  if (!dbPromise) {
    dbPromise = getTursoClient().then((client) => drizzle(client, { schema }));
  }
  return dbPromise;
};
