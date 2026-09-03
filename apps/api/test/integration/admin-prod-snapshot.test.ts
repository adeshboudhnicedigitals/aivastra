import { schema } from '@aivastra/db';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /admin/prod-snapshot/* — DEV_SNAPSHOT_* unset', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('status reports not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/status',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });

  it('download-url reports not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/download-url',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });

  it('rejects a non-superadmin role', async () => {
    const adminHeader = await adminAuthHeader(app, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/status',
      headers: adminHeader,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/prod-snapshot/* — DEV_SNAPSHOT_* configured', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;
  let s3: S3Client;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      DEV_SNAPSHOT_ENDPOINT: c.r2Endpoint,
      DEV_SNAPSHOT_BUCKET: c.r2Bucket,
      DEV_SNAPSHOT_ACCESS_KEY_ID: c.r2Key,
      DEV_SNAPSHOT_SECRET_ACCESS_KEY: c.r2Secret,
    });
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
    s3 = new S3Client({
      endpoint: c.r2Endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: c.r2Key, secretAccessKey: c.r2Secret },
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('status reports configured, not found before any export exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/status',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, found: false });
  });

  it('download-url reports configured, not found before any dump exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/download-url',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, found: false });
  });

  it('status returns the manifest once one is uploaded', async () => {
    const manifest = {
      exportedAt: '2026-09-03T00:00:00.000Z',
      excludedTableData: ['payments', 'audit_logs'],
      schemaMarker: 'test-hash',
    };
    await s3.send(
      new PutObjectCommand({
        Bucket: c.r2Bucket,
        Key: 'db/manifest.json',
        Body: JSON.stringify(manifest),
        ContentType: 'application/json',
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/status',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, found: true, manifest });
  });

  it('download-url returns a presigned URL once a dump exists, and writes an audit row', async () => {
    await s3.send(
      new PutObjectCommand({
        Bucket: c.r2Bucket,
        Key: 'db/latest.dump.age',
        Body: Buffer.from('fake encrypted dump'),
        ContentType: 'application/octet-stream',
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/admin/prod-snapshot/download-url',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.found).toBe(true);
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('latest.dump.age');

    const rows = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'prod_snapshot.download_url_issued'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
