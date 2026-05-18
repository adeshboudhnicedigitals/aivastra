import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';

export interface Containers {
  pgUrl: string; redisUrl: string;
  r2Endpoint: string; r2Key: string; r2Secret: string; r2Bucket: string;
  stop: () => Promise<void>;
}

export async function startContainers(): Promise<Containers> {
  const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Create fresh test database in existing Postgres
  const adminUrl = 'postgres://tryon:tryon_dev_pw@127.0.0.1:5432/tryon_dev';
  const adminClient = postgres(adminUrl, { max: 1 });
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();

  const pgUrl = `postgres://tryon:tryon_dev_pw@127.0.0.1:5432/${dbName}`;
  const client = postgres(pgUrl, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: './node_modules/@aivastra/db/src/migrations' });
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
    redisUrl: 'redis://127.0.0.1:6379',
    r2Endpoint, r2Key: 'minioadmin', r2Secret: 'minioadmin_dev_pw', r2Bucket: bucket,
    stop: async () => {
      const cleanupClient = postgres(adminUrl, { max: 1 });
      await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await cleanupClient.end();
      try {
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      } catch { /* ignore */ }
    },
  };
}
