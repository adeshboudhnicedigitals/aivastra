import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DB = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

export function createDb(url: string): { db: DB; close: () => Promise<void> } {
  const client = postgres(url, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
export * as schema from './schema/index.js';
export type {
  ShopifyWidgetBehavior,
  ShopifyWidgetConfig,
  ShopifyWidgetCopy,
  ShopifyWidgetTheme,
} from './schema/shopify.js';
