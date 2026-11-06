import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// Shared at module scope so later describe blocks (branch/staff CRUD) reuse the
// same containers and app instead of paying startup per block.
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

describe('merchant org — member resolution', () => {
  it('resolves the merchant owner as admin', async () => {
    const m = await createTestMerchant(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/org/me',
      headers: await memberAuthHeader(app, m.userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      merchantId: m.merchantId,
      role: 'admin',
      branchId: null,
      companyName: 'Test Co',
      staffLimitPerBranch: 2,
    });
  });

  it('resolves a staff user to their branch', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const res = await app.inject({ method: 'GET', url: '/v1/merchant/org/me', headers: s.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      merchantId: m.merchantId,
      role: 'staff',
      branchId: b.id,
      companyName: 'Test Co',
      staffLimitPerBranch: 2,
    });
  });

  it('rejects deactivated staff, staff of a deactivated branch, and inactive merchants', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const inactive = await createTestStaff(app, m.merchantId, b.id, { isActive: false });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/merchant/org/me', headers: inactive.auth }))
        .statusCode,
    ).toBe(403);

    const s = await createTestStaff(app, m.merchantId, b.id);
    await app.db
      .update(schema.merchantBranches)
      .set({ isActive: false })
      .where(eq(schema.merchantBranches.id, b.id));
    expect(
      (await app.inject({ method: 'GET', url: '/v1/merchant/org/me', headers: s.auth })).statusCode,
    ).toBe(403);

    const off = await createTestMerchant(app, { isActive: false });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/merchant/org/me',
          headers: await memberAuthHeader(app, off.userId),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('rejects a user who is neither owner nor staff', async () => {
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: `nobody-${randomUUID()}@test.com`, emailVerified: true })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/org/me',
      headers: await memberAuthHeader(app, u!.id),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('merchant org — branches and staff', () => {
  it('admin creates a branch; staff cannot', async () => {
    const m = await createTestMerchant(app);
    const admin = await memberAuthHeader(app, m.userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/branches',
      headers: admin,
      payload: { name: 'Bandra', city: 'Mumbai' },
    });
    expect(res.statusCode).toBe(201);
    const branchId = res.json().id as string;

    const s = await createTestStaff(app, m.merchantId, branchId);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/branches',
      headers: s.auth,
      payload: { name: 'Nope' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('staff only see their own branch and its staff', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId, { name: 'One' });
    const b2 = await createTestBranch(app, m.merchantId, { name: 'Two' });
    const s1 = await createTestStaff(app, m.merchantId, b1.id);
    await createTestStaff(app, m.merchantId, b2.id);

    const branches = (
      await app.inject({ method: 'GET', url: '/v1/merchant/org/branches', headers: s1.auth })
    ).json();
    expect(branches.branches.map((b: { id: string }) => b.id)).toEqual([b1.id]);

    const staff = (
      await app.inject({ method: 'GET', url: '/v1/merchant/org/staff', headers: s1.auth })
    ).json();
    expect(staff.staff.every((r: { branchId: string }) => r.branchId === b1.id)).toBe(true);

    const adminView = (
      await app.inject({
        method: 'GET',
        url: '/v1/merchant/org/staff',
        headers: await memberAuthHeader(app, m.userId),
      })
    ).json();
    expect(adminView.staff).toHaveLength(2);
  });

  it('enforces the staff limit, including two concurrent creates', async () => {
    const m = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ staffLimitPerBranch: 1 })
      .where(eq(schema.merchants.id, m.merchantId));
    const b = await createTestBranch(app, m.merchantId);
    const admin = await memberAuthHeader(app, m.userId);
    const create = (n: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/merchant/org/staff',
        headers: admin,
        payload: {
          branchId: b.id,
          email: `race-${n}-${randomUUID()}@test.com`,
          password: 'password123',
          displayName: `S${n}`,
        },
      });

    const [r1, r2] = await Promise.all([create(1), create(2)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json().error.code).toBe('STAFF_LIMIT_REACHED');

    const rows = await app.db
      .select()
      .from(schema.merchantStaff)
      .where(eq(schema.merchantStaff.branchId, b.id));
    expect(rows).toHaveLength(1);
  });

  it('a deactivated staff member frees a seat; re-activating at the limit is refused', async () => {
    const m = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ staffLimitPerBranch: 1 })
      .where(eq(schema.merchants.id, m.merchantId));
    const b = await createTestBranch(app, m.merchantId);
    const first = await createTestStaff(app, m.merchantId, b.id);
    const admin = await memberAuthHeader(app, m.userId);

    const off = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${first.staffId}`,
      headers: admin,
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect(Object.keys(off.json()).sort()).toEqual([
      'branchId',
      'createdAt',
      'displayName',
      'email',
      'id',
      'isActive',
      'userId',
    ]);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/staff',
      headers: admin,
      payload: {
        branchId: b.id,
        email: `seat-${randomUUID()}@test.com`,
        password: 'password123',
        displayName: 'Second',
      },
    });
    expect(second.statusCode).toBe(201);

    const back = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${first.staffId}`,
      headers: admin,
      payload: { isActive: true },
    });
    expect(back.statusCode).toBe(409);
    expect(back.json().error.code).toBe('STAFF_LIMIT_REACHED');
  });

  it('created staff can log in with the existing auth route', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const email = `login-${randomUUID()}@test.com`;
    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/staff',
      headers: await memberAuthHeader(app, m.userId),
      payload: { branchId: b.id, email, password: 'password123', displayName: 'Login Staff' },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
      remoteAddress: '192.0.2.41',
    });
    expect(login.statusCode).toBe(200);
  });

  it("cannot touch another merchant's branch or staff", async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const os = await createTestStaff(app, other.merchantId, ob.id);
    const admin = await memberAuthHeader(app, a.userId);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/merchant/org/branches/${ob.id}`,
          headers: admin,
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/merchant/org/staff/${os.staffId}`,
          headers: admin,
          payload: { isActive: false },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/merchant/org/staff',
          headers: admin,
          payload: {
            branchId: ob.id,
            email: `x-${randomUUID()}@test.com`,
            password: 'password123',
            displayName: 'X',
          },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('writes an audit row for staff creation', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/staff',
      headers: await memberAuthHeader(app, m.userId),
      payload: {
        branchId: b.id,
        email: `audit-${randomUUID()}@test.com`,
        password: 'password123',
        displayName: 'A',
      },
    });
    const rows = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, res.json().id));
    expect(rows.map((r) => r.action)).toContain('merchant_staff.create');
  });

  it('staff cannot create or update staff', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const post = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/staff',
      headers: s.auth,
      payload: {
        branchId: b.id,
        email: `s-${randomUUID()}@test.com`,
        password: 'password123',
        displayName: 'N',
      },
    });
    expect(post.statusCode).toBe(403);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${s.staffId}`,
      headers: s.auth,
      payload: { isActive: false },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('moving staff into a full branch is refused; into a foreign branch is 404', async () => {
    const m = await createTestMerchant(app);
    await app.db
      .update(schema.merchants)
      .set({ staffLimitPerBranch: 1 })
      .where(eq(schema.merchants.id, m.merchantId));
    const b1 = await createTestBranch(app, m.merchantId, { name: 'A' });
    const b2 = await createTestBranch(app, m.merchantId, { name: 'B' });
    const mover = await createTestStaff(app, m.merchantId, b1.id);
    await createTestStaff(app, m.merchantId, b2.id);
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const admin = await memberAuthHeader(app, m.userId);

    const full = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${mover.staffId}`,
      headers: admin,
      payload: { branchId: b2.id },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('STAFF_LIMIT_REACHED');

    const foreign = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${mover.staffId}`,
      headers: admin,
      payload: { branchId: ob.id },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('writes an audit row for staff update', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const st = await createTestStaff(app, m.merchantId, b.id);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${st.staffId}`,
      headers: await memberAuthHeader(app, m.userId),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const rows = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, st.staffId));
    expect(rows.map((r) => r.action)).toContain('merchant_staff.update');
  });

  it('concurrent creates with the same email in different branches: loser gets 409 CONFLICT', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId, { name: 'X' });
    const b2 = await createTestBranch(app, m.merchantId, { name: 'Y' });
    const admin = await memberAuthHeader(app, m.userId);
    const email = `dup-${randomUUID()}@test.com`;
    const create = (branchId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/merchant/org/staff',
        headers: admin,
        payload: { branchId, email, password: 'password123', displayName: 'Dup' },
      });
    const [r1, r2] = await Promise.all([create(b1.id), create(b2.id)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json().error.code).toBe('CONFLICT');
  });

  it('cannot write a foreign branch onto staff when no seat is consumed', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId, { name: 'Own1' });
    const b2 = await createTestBranch(app, m.merchantId, { name: 'Own2' });
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const admin = await memberAuthHeader(app, m.userId);
    const inactive = await createTestStaff(app, m.merchantId, b1.id, { isActive: false });
    const active = await createTestStaff(app, m.merchantId, b1.id);
    const reread = async (id: string) =>
      (await app.db.select().from(schema.merchantStaff).where(eq(schema.merchantStaff.id, id)))[0]!;

    const r1 = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${inactive.staffId}`,
      headers: admin,
      payload: { branchId: ob.id },
    });
    expect(r1.statusCode).toBe(404);
    expect(await reread(inactive.staffId)).toMatchObject({
      branchId: b1.id,
      merchantId: m.merchantId,
    });

    const r2 = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${active.staffId}`,
      headers: admin,
      payload: { isActive: false, branchId: ob.id },
    });
    expect(r2.statusCode).toBe(404);
    expect(await reread(active.staffId)).toMatchObject({ branchId: b1.id, isActive: true });

    // Positive: an inactive member may move to another branch of the same merchant.
    const ok = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/staff/${inactive.staffId}`,
      headers: admin,
      payload: { branchId: b2.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(await reread(inactive.staffId)).toMatchObject({ branchId: b2.id, isActive: false });
  });

  it('staff create email check is case-insensitive against existing accounts', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const local = `Mixed.Case-${randomUUID()}`;
    await app.db.insert(schema.users).values({ email: `${local}@Test.com`, emailVerified: true });
    const lower = `${local}@test.com`.toLowerCase();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/staff',
      headers: await memberAuthHeader(app, m.userId),
      payload: { branchId: b.id, email: lower, password: 'password123', displayName: 'Dup' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    const rows = await app.db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${lower}`);
    expect(rows).toHaveLength(1);
  });
});
