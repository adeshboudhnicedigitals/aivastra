import { schema } from '@aivastra/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function storedUrl(merchantId: string) {
  const [row] = await app.db
    .select({ storeUrl: schema.merchants.storeUrl })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId));
  return row?.storeUrl;
}

async function auditRows(merchantId: string) {
  return app.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.resourceId, merchantId),
        eq(schema.auditLogs.action, 'merchant.brand_update'),
      ),
    );
}

async function patch(userId: string, payload: unknown) {
  return app.inject({
    method: 'PATCH',
    url: '/v1/merchant/brand',
    headers: await memberAuthHeader(app, userId),
    payload: payload as object,
  });
}

describe('GET /v1/merchant/brand', () => {
  it('returns the brand shape with logoUrl null when no logo is set', async () => {
    const m = await createTestMerchant(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/brand',
      headers: await memberAuthHeader(app, m.userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      companyName: 'Test Co',
      storeUrl: null,
      logoUrl: null,
      logoOverlayEnabled: expect.any(Boolean),
      staffLimitPerBranch: 2,
      deviceQuotaPerMonth: null,
    });
  });

  it('returns a URL for logoUrl and never the raw key', async () => {
    const m = await createTestMerchant(app);
    const logoKey = `merchants/${m.merchantId}/logo-secret-key.png`;
    await app.db
      .update(schema.merchants)
      .set({ logoKey })
      .where(eq(schema.merchants.id, m.merchantId));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/brand',
      headers: await memberAuthHeader(app, m.userId),
    });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(() => new URL(body.logoUrl)).not.toThrow();
    expect(body).not.toHaveProperty('logoKey');
    expect(Object.keys(body).sort()).toEqual(
      [
        'companyName',
        'deviceQuotaPerMonth',
        'logoOverlayEnabled',
        'logoUrl',
        'staffLimitPerBranch',
        'storeUrl',
      ].sort(),
    );
  });

  it('lets staff read the same fields', async () => {
    const m = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ storeUrl: 'https://own.example.com' })
      .where(eq(schema.merchants.id, m.merchantId));
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const res = await app.inject({ method: 'GET', url: '/v1/merchant/brand', headers: s.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      companyName: 'Test Co',
      storeUrl: 'https://own.example.com',
    });
  });

  it('never returns another merchant brand', async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ storeUrl: 'https://other.example.com', companyName: 'Other Co' })
      .where(eq(schema.merchants.id, other.merchantId));
    const res = await app.inject({
      method: 'GET',
      url: `/v1/merchant/brand?merchantId=${other.merchantId}`,
      headers: await memberAuthHeader(app, a.userId),
    });
    expect(res.json()).toMatchObject({ companyName: 'Test Co', storeUrl: null });
  });

  it('rejects unauthenticated callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/merchant/brand' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/merchant/brand', () => {
  it('sets storeUrl, returns the GET shape, writes exactly one audit row', async () => {
    const m = await createTestMerchant(app);
    const res = await patch(m.userId, { storeUrl: 'https://shop.example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      companyName: 'Test Co',
      storeUrl: 'https://shop.example.com',
      logoUrl: null,
    });
    expect(await storedUrl(m.merchantId)).toBe('https://shop.example.com');

    const rows = await auditRows(m.merchantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: m.userId,
      actorRole: 'MERCHANT_ADMIN',
      resourceType: 'merchant',
      before: { storeUrl: null },
      after: { storeUrl: 'https://shop.example.com' },
    });
  });

  it('clears storeUrl with null and audits before/after', async () => {
    const m = await createTestMerchant(app);
    await patch(m.userId, { storeUrl: 'https://shop.example.com' });
    const res = await patch(m.userId, { storeUrl: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().storeUrl).toBeNull();
    expect(await storedUrl(m.merchantId)).toBeNull();
    const rows = await auditRows(m.merchantId);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => (r.after as { storeUrl: unknown }).storeUrl === null)).toBe(true);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,x'],
    ['ftp:', 'ftp://x.com'],
    ['over-long', `https://x.com/${'a'.repeat(500)}`],
    ['empty string', ''],
  ])('rejects %s with 400 and leaves the stored value unchanged', async (_n, value) => {
    const m = await createTestMerchant(app);
    await patch(m.userId, { storeUrl: 'https://keep.example.com' });
    const res = await patch(m.userId, { storeUrl: value });
    expect(res.statusCode).toBe(400);
    expect(await storedUrl(m.merchantId)).toBe('https://keep.example.com');
    expect(await auditRows(m.merchantId)).toHaveLength(1);
  });

  it('ignores fields other than storeUrl (body must carry storeUrl)', async () => {
    const m = await createTestMerchant(app);
    const res = await patch(m.userId, { companyName: 'Hacked' });
    expect(res.statusCode).toBe(400);
    const res2 = await patch(m.userId, { storeUrl: null, companyName: 'Hacked' });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().companyName).toBe('Test Co');
  });

  it('forbids staff and leaves the value unchanged', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/merchant/brand',
      headers: s.auth,
      payload: { storeUrl: 'https://staff.example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(await storedUrl(m.merchantId)).toBeNull();
    expect(await auditRows(m.merchantId)).toHaveLength(0);
  });

  it('only ever patches the caller merchant, whatever params are sent', async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/brand?merchantId=${other.merchantId}`,
      headers: await memberAuthHeader(app, a.userId),
      payload: { storeUrl: 'https://mine.example.com', merchantId: other.merchantId },
    });
    expect(res.statusCode).toBe(200);
    expect(await storedUrl(a.merchantId)).toBe('https://mine.example.com');
    expect(await storedUrl(other.merchantId)).toBeNull();
    expect(await auditRows(other.merchantId)).toHaveLength(0);
  });

  it('rolls the update back when the audit write fails (fail-closed)', async () => {
    const m = await createTestMerchant(app);
    await patch(m.userId, { storeUrl: 'https://before.example.com' });
    // Force the audit insert to fail inside the route's transaction. The per-file test
    // database is private, so a temporary trigger cannot affect other files.
    await app.db.execute(sql`
      CREATE FUNCTION test_fail_brand_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'merchant.brand_update' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await app.db.execute(sql`
      CREATE TRIGGER test_fail_brand_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_brand_audit()`);
    try {
      const res = await patch(m.userId, { storeUrl: 'https://after.example.com' });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(await storedUrl(m.merchantId)).toBe('https://before.example.com');
    } finally {
      await app.db.execute(sql`DROP TRIGGER test_fail_brand_audit ON audit_logs`);
      await app.db.execute(sql`DROP FUNCTION test_fail_brand_audit()`);
    }
  });
});
