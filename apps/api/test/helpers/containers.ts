import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export interface Containers {
  pgUrl: string;
  redisUrl: string;
  r2Endpoint: string;
  r2Key: string;
  r2Secret: string;
  r2Bucket: string;
  stop: () => Promise<void>;
}

export async function startContainers(): Promise<Containers> {
  const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Postgres host port is configurable via .env (POSTGRES_PORT) — defaults to the
  // docker-compose default of 5432, but local setups sometimes remap it (e.g. 5433)
  // to avoid colliding with a system-wide Postgres install.
  const pgPort = process.env.POSTGRES_PORT ?? '5432';
  const pgUser = process.env.POSTGRES_USER ?? 'tryon';
  const pgPassword = process.env.POSTGRES_PASSWORD ?? 'tryon_dev_pw';
  const pgDb = process.env.POSTGRES_DB ?? 'tryon_dev';

  // Create fresh test database in existing Postgres
  const adminUrl = `postgres://${pgUser}:${pgPassword}@127.0.0.1:${pgPort}/${pgDb}`;
  const adminClient = postgres(adminUrl, { max: 1 });
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();

  const pgUrl = `postgres://${pgUser}:${pgPassword}@127.0.0.1:${pgPort}/${dbName}`;
  const client = postgres(pgUrl, { max: 1 });
  await migrate(drizzle(client), {
    migrationsFolder: './node_modules/@aivastra/db/src/migrations',
  });
  await client.end();

  const r2Endpoint = 'http://127.0.0.1:9000';
  const s3 = new S3Client({
    endpoint: r2Endpoint,
    region: 'auto',
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin_dev_pw' },
    forcePathStyle: true,
  });

  const bucket = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  return {
    pgUrl,
    // Dedicated DB index, never 0 (dev/prod default) — tests do destructive
    // redis.del('jobs:normal'/'jobs:priority') as setup, which previously wiped
    // out a live dev dispatcher's consumer group running against the same Redis.
    // ponytail: still a single shared DB across parallel test files (unlike the
    // per-file Postgres DB / MinIO bucket), so cross-file key races are possible;
    // fix if a test starts flaking on shared queue-length assertions.
    redisUrl: 'redis://127.0.0.1:6379/15',
    r2Endpoint,
    r2Key: 'minioadmin',
    r2Secret: 'minioadmin_dev_pw',
    r2Bucket: bucket,
    stop: async () => {
      const cleanupClient = postgres(adminUrl, { max: 1 });
      await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await cleanupClient.end();
      try {
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      } catch {
        /* ignore */
      }
    },
  };
}
