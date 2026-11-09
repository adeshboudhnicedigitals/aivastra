import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Distinct from the api suite's template so the two can run against one local
// Postgres at the same time without one teardown dropping the other's template.
export const TEST_TEMPLATE_DB = 'tryon_dispatcher_test_template';

function urlFor(db: string): string {
  const pgPort = process.env.POSTGRES_PORT ?? '5432';
  return `postgres://tryon:tryon_dev_pw@127.0.0.1:${pgPort}/${db}`;
}

// Runs the full migration chain once per test run into a template database;
// setupTestEnv (test/helpers/containers.ts) then clones it per file with
// `CREATE DATABASE ... TEMPLATE`, a file copy, instead of replaying 250+
// migrations for each of the ~45 files (the suite runs them serially).
export async function setup(): Promise<void> {
  const admin = postgres(urlFor('tryon_dev'), { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${TEST_TEMPLATE_DB}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${TEST_TEMPLATE_DB}"`);
  await admin.end();

  const client = postgres(urlFor(TEST_TEMPLATE_DB), { max: 1 });
  await migrate(drizzle(client), {
    migrationsFolder: './node_modules/@aivastra/db/src/migrations',
  });
  await client.end();
}

export async function teardown(): Promise<void> {
  const admin = postgres(urlFor('tryon_dev'), { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${TEST_TEMPLATE_DB}" WITH (FORCE)`);
  await admin.end();
}
