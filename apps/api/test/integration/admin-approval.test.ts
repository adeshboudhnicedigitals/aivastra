import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

describe('admin-approval', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerAndVerify(email: string) {
    return createVerifiedUserToken(app, email);
  }

  it('regular user can request admin', async () => {
    const { token, userId } = await registerAndVerify('req1@test.com');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
    const [row] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, userId));
    expect(row.status).toBe('pending');
  });

  it('re-request while pending is idempotent', async () => {
    const { token } = await registerAndVerify('req2@test.com');
    await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
  });

  it('active admin cannot re-request', async () => {
    const { token, userId } = await registerAndVerify('req3@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('pending user blocked from admin routes', async () => {
    const { token, userId } = await registerAndVerify('req4@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'pending' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejected user blocked from admin routes', async () => {
    const { token, userId } = await registerAndVerify('req5@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'rejected' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejected user can re-apply', async () => {
    const { token, userId } = await registerAndVerify('req6@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'rejected' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, userId));
    expect(row.status).toBe('pending');
  });

  it('super admin can list pending requests', async () => {
    const { token: superToken, userId: superId } = await registerAndVerify('super-lr@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: superId, role: 'SUPER_ADMIN', status: 'active' });
    const { token: pendingToken } = await registerAndVerify('pending-lr@test.com');
    await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${pendingToken}` },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/admin-requests',
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    expect(res.json().items[0]).toHaveProperty('email');
    expect(res.json().items[0]).toHaveProperty('role');
  });

  it('super admin can approve a request', async () => {
    const { token: superToken, userId: superId } = await registerAndVerify('super-ap@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: superId, role: 'SUPER_ADMIN', status: 'active' });
    const { token: reqToken, userId: requestUserId } =
      await registerAndVerify('approve-target@test.com');
    await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${reqToken}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/admin-requests/${requestUserId}/approve`,
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const [row] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, requestUserId));
    expect(row.status).toBe('active');
  });

  it('super admin can reject a request', async () => {
    const { token: superToken, userId: superId } = await registerAndVerify('super-rj@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: superId, role: 'SUPER_ADMIN', status: 'active' });
    const { token: reqToken, userId: requestUserId } =
      await registerAndVerify('reject-target@test.com');
    await app.inject({
      method: 'POST',
      url: '/v1/auth/request-admin',
      headers: { authorization: `Bearer ${reqToken}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/admin-requests/${requestUserId}/reject`,
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const [row] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, requestUserId));
    expect(row.status).toBe('rejected');
  });

  it('super admin can revoke an active admin', async () => {
    const { token: superToken, userId: superId } = await registerAndVerify('super-rv@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: superId, role: 'SUPER_ADMIN', status: 'active' });
    const { userId: adminId } = await registerAndVerify('revoke-me@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: adminId, role: 'ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/admin-users/${adminId}`,
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, adminId));
    expect(row).toBeUndefined();
  });

  it('approved ADMIN can access admin routes', async () => {
    const { token, userId } = await registerAndVerify('admin-ok@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it('ADMIN cannot delete assets', async () => {
    const { token, userId } = await registerAndVerify('admin-nodel@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/assets/faces/00000000-0000-0000-0000-000000000001',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ADMIN can read workflows', async () => {
    const { token, userId } = await registerAndVerify('admin-nowf@test.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/workflows',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('non-admin cannot approve/reject requests', async () => {
    const { token, userId } = await registerAndVerify('rando@test.com');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/admin-requests/${userId}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('super admin cannot revoke themselves', async () => {
    const { token, userId } = await registerAndVerify('self-revoke@test.com');
    await app.db
      .insert(schema.adminUsers)
      .values({ userId, role: 'SUPER_ADMIN', status: 'active' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/admin-users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
