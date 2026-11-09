import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestMerchant, createTestStaff } from '../helpers/merchant';

describe('admin — merchant org', () => {
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

  it('edits staff limit, device quota and store URL, with an audit row', async () => {
    const m = await createTestMerchant(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${m.merchantId}`,
      headers: await adminAuthHeader(app),
      payload: {
        staffLimitPerBranch: 4,
        deviceQuotaPerMonth: 1000,
        storeUrl: 'https://shop.example.com',
      },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, m.merchantId));
    expect(row).toMatchObject({
      staffLimitPerBranch: 4,
      deviceQuotaPerMonth: 1000,
      storeUrl: 'https://shop.example.com',
    });

    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, m.merchantId));
    const last = audits.find((a) => a.action === 'merchant.update');
    expect((last!.after as Record<string, unknown>).staffLimitPerBranch).toBe(4);
    expect((last!.before as Record<string, unknown>).staffLimitPerBranch).toBe(2);
  });

  it('returns branches with their staff', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId, { name: 'Andheri' });
    await createTestStaff(app, m.merchantId, b.id);
    const res = await app.inject({
      method: 'GET',
      url: `/admin/merchants/${m.merchantId}/org`,
      headers: await adminAuthHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.staffLimitPerBranch).toBe(2);
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].staff).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('can deactivate a branch and a staff member; respects the limit on re-activation', async () => {
    const m = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ staffLimitPerBranch: 1 })
      .where(eq(schema.merchants.id, m.merchantId));
    const b = await createTestBranch(app, m.merchantId);
    const s1 = await createTestStaff(app, m.merchantId, b.id, { isActive: false });
    await createTestStaff(app, m.merchantId, b.id);
    const admin = await adminAuthHeader(app);

    const reactivate = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${m.merchantId}/staff/${s1.staffId}`,
      headers: admin,
      payload: { isActive: true },
    });
    expect(reactivate.statusCode).toBe(409);
    expect(reactivate.json().error.code).toBe('STAFF_LIMIT_REACHED');

    // Deactivating never consumes a seat, so it must succeed even at the limit.
    const active = await createTestStaff(
      app,
      m.merchantId,
      (await createTestBranch(app, m.merchantId)).id,
    );
    const deact = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${m.merchantId}/staff/${active.staffId}`,
      headers: admin,
      payload: { isActive: false },
    });
    expect(deact.statusCode).toBe(200);
    expect(deact.json()).toMatchObject({ id: active.staffId, isActive: false });
    expect(deact.json().email).toBeTruthy();

    const off = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${m.merchantId}/branches/${b.id}`,
      headers: admin,
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().isActive).toBe(false);
  });

  // 0167_permissions.sql grants SUPPORT no merchants.* keys at all (neither read nor
  // write), and no later migration adds them, so SUPPORT must be refused everywhere.
  it('SUPPORT is refused on every new admin merchant-org route', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const support = await adminAuthHeader(app, 'SUPPORT');
    const base = `/admin/merchants/${m.merchantId}`;
    const cases: Array<{ method: 'GET' | 'PATCH'; url: string; payload?: object }> = [
      { method: 'GET', url: `${base}/org` },
      { method: 'PATCH', url: base, payload: { staffLimitPerBranch: 9 } },
      { method: 'PATCH', url: `${base}/branches/${b.id}`, payload: { isActive: false } },
      { method: 'PATCH', url: `${base}/staff/${s.staffId}`, payload: { isActive: false } },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: c.method,
        url: c.url,
        headers: support,
        payload: c.payload,
      });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
    const [row] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, m.merchantId));
    expect(row!.staffLimitPerBranch).toBe(2);
  });

  // Mirrors the agreed-price routes (requireAdmin SUPER_ADMIN/ADMIN): ADMIN can correct a
  // merchant's branches and staff, but the staff limit, quota and store URL stay SUPER_ADMIN.
  it('ADMIN may edit branches and staff but not merchant limits; MODERATOR may do neither', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const base = `/admin/merchants/${m.merchantId}`;
    const adminRole = await adminAuthHeader(app, 'ADMIN');

    const branch = await app.inject({
      method: 'PATCH',
      url: `${base}/branches/${b.id}`,
      headers: adminRole,
      payload: { isActive: false },
    });
    expect(branch.statusCode).toBe(200);
    const staff = await app.inject({
      method: 'PATCH',
      url: `${base}/staff/${s.staffId}`,
      headers: adminRole,
      payload: { isActive: false },
    });
    expect(staff.statusCode).toBe(200);
    const limits = await app.inject({
      method: 'PATCH',
      url: base,
      headers: adminRole,
      payload: { staffLimitPerBranch: 9 },
    });
    expect(limits.statusCode).toBe(403);

    const mod = await adminAuthHeader(app, 'MODERATOR');
    for (const url of [`${base}/branches/${b.id}`, `${base}/staff/${s.staffId}`]) {
      const res = await app.inject({
        method: 'PATCH',
        url,
        headers: mod,
        payload: { isActive: true },
      });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('leaves branches and staff of other merchants alone when :id mismatches', async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const b = await createTestBranch(app, a.merchantId);
    const s = await createTestStaff(app, a.merchantId, b.id);
    const admin = await adminAuthHeader(app);

    const branchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${other.merchantId}/branches/${b.id}`,
      headers: admin,
      payload: { isActive: false },
    });
    expect(branchRes.statusCode).toBe(404);
    const staffRes = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${other.merchantId}/staff/${s.staffId}`,
      headers: admin,
      payload: { isActive: false },
    });
    expect(staffRes.statusCode).toBe(404);

    const [br] = await app.db
      .select()
      .from(schema.merchantBranches)
      .where(eq(schema.merchantBranches.id, b.id));
    const [st] = await app.db
      .select()
      .from(schema.merchantStaff)
      .where(eq(schema.merchantStaff.id, s.staffId));
    expect(br!.isActive).toBe(true);
    expect(st!.isActive).toBe(true);
  });

  it('admin staff PATCH refuses a foreign branch even when no seat is consumed', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const inactive = await createTestStaff(app, m.merchantId, b.id, { isActive: false });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${m.merchantId}/staff/${inactive.staffId}`,
      headers: await adminAuthHeader(app),
      payload: { branchId: ob.id },
    });
    expect(res.statusCode).toBe(404);
    const [st] = await app.db
      .select()
      .from(schema.merchantStaff)
      .where(eq(schema.merchantStaff.id, inactive.staffId));
    expect(st).toMatchObject({ branchId: b.id, merchantId: m.merchantId });
  });

  it('rejects a non-http store URL and an out-of-range device quota; accepts https', async () => {
    const m = await createTestMerchant(app);
    const url = `/admin/merchants/${m.merchantId}`;
    const headers = await adminAuthHeader(app);
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url, headers, payload });
    expect((await patch({ storeUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await patch({ storeUrl: 'not a url' })).statusCode).toBe(400);
    expect((await patch({ deviceQuotaPerMonth: 2_000_000_000 })).statusCode).toBe(400);
    expect((await patch({ storeUrl: 'https://shop.example.com' })).statusCode).toBe(200);
    expect((await patch({ storeUrl: null })).statusCode).toBe(200);
  });
});
