import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type DB = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: DB; close: () => Promise<void> } {
  const client = postgres(url, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export * as schema from './schema';
