import { eq, schema, sql } from '@aivastra/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const KEY = 'config:workflow-comparison';
const URL = '/admin/comparison/settings';

describe('admin comparison settings', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;
  let auditCount: number;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  beforeEach(async () => {
    // Redis indexes are leased per file and not flushed on release, so a previous
    // comparison test file may have left the key behind.
    await app.redis.del(KEY);
    auditCount = (await app.db.select().from(schema.auditLogs)).length;
  });

  afterEach(async () => {
    await app.redis.del(KEY);
  });

  const patch = (payload: object, headers = adminAuth) =>
    app.inject({ method: 'PATCH', url: URL, headers, payload });

  it('defaults to disabled when no configuration exists', async () => {
    const res = await app.inject({ method: 'GET', url: URL, headers: adminAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: false,
      backlogCap: 200,
      retentionDays: 30,
      enabledSince: null,
    });
  });

  it('records enabling in audit history and keeps the start time on repeated enable', async () => {
    const res = await patch({ enabled: true });
    expect(res.statusCode).toBe(200);
    const initial = res.json();
    expect(initial.enabled).toBe(true);
    expect(Number.isFinite(Date.parse(initial.enabledSince))).toBe(true);
    const audits = await app.db.select().from(schema.auditLogs);
    expect(audits).toHaveLength(auditCount + 1);
    expect(audits[0]?.before).toEqual({
      enabled: false,
      backlogCap: 200,
      retentionDays: 30,
      enabledSince: null,
    });
    expect(audits[0]?.after).toEqual(initial);
    expect(audits[0]?.resourceType).toBe('workflow_comparison_settings');
    expect((await patch({ enabled: true })).json().enabledSince).toBe(initial.enabledSince);
    expect(JSON.parse((await app.redis.get(KEY)) ?? 'null')).toEqual(initial);
  });

  it('starts a new collection window only when disabled settings are enabled again', async () => {
    await app.redis.set(
      KEY,
      JSON.stringify({
        enabled: true,
        backlogCap: 12,
        retentionDays: 7,
        enabledSince: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect((await patch({ enabled: false })).json().enabledSince).toBe('2026-01-01T00:00:00.000Z');
    const res = await patch({ enabled: true });
    expect(res.statusCode).toBe(200);
    expect(Date.parse(res.json().enabledSince)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    expect(res.json().backlogCap).toBe(12);
  });

  it.each([
    { backlogCap: 0 },
    { backlogCap: 5001 },
    { backlogCap: 1.5 },
    { retentionDays: 0 },
    { retentionDays: 366 },
    { enabled: 'true' },
  ])('rejects invalid settings %j', async (body) => {
    expect((await patch(body)).statusCode).toBe(400);
    expect(await app.redis.get(KEY)).toBeNull();
    expect(await app.db.select().from(schema.auditLogs)).toHaveLength(auditCount);
  });

  it('requires config.write independently from config.read', async () => {
    const auth = await adminAuthHeader(app, 'SUPPORT');
    await app.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.role, 'SUPPORT'));
    const [permission] = await app.db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.key, 'config.read'));
    if (!permission) throw new Error('Missing seeded config.read permission');
    await app.db
      .insert(schema.rolePermissions)
      .values({ role: 'SUPPORT', permissionId: permission.id });
    expect((await app.inject({ method: 'GET', url: URL, headers: auth })).statusCode).toBe(200);
    expect((await patch({ enabled: true }, auth)).statusCode).toBe(403);
    await app.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.role, 'SUPPORT'));
    expect((await app.inject({ method: 'GET', url: URL, headers: auth })).statusCode).toBe(403);
    expect(await app.redis.get(KEY)).toBeNull();
  });

  it.each([
    'not-json',
    'null',
    '[]',
    '{"enabled":"true"}',
    '{"enabled":true,"backlogCap":0}',
    '{"enabled":true,"enabledSince":"yesterday"}',
  ])('fails closed for corrupt stored configuration %s', async (raw) => {
    await app.redis.set(KEY, raw);
    const res = await app.inject({ method: 'GET', url: URL, headers: adminAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(res.json().enabledSince).toBeNull();
  });

  it('preserves both independently patched fields under concurrent requests', async () => {
    const results = await Promise.all([
      patch({ enabled: true }),
      patch({ backlogCap: 123 }),
      patch({ retentionDays: 17 }),
    ]);
    expect(results.map((res) => res.statusCode)).toEqual([200, 200, 200]);
    const res = await app.inject({ method: 'GET', url: URL, headers: adminAuth });
    expect(res.json()).toMatchObject({ enabled: true, backlogCap: 123, retentionDays: 17 });
    expect(await app.db.select().from(schema.auditLogs)).toHaveLength(auditCount + 3);
  });

  it('keeps Redis unchanged if the audit insert fails', async () => {
    await app.db.execute(
      sql`ALTER TABLE audit_logs ADD CONSTRAINT comparison_test_reject_audit CHECK (resource_type <> 'workflow_comparison_settings') NOT VALID`,
    );
    try {
      expect((await patch({ enabled: true })).statusCode).toBe(500);
      expect(await app.redis.get(KEY)).toBeNull();
    } finally {
      await app.db.execute(
        sql`ALTER TABLE audit_logs DROP CONSTRAINT comparison_test_reject_audit`,
      );
    }
  });
});
