import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
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

describe('merchant device management', () => {
  it('admin creates a device and gets a one-time pairing code that pairs', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const admin = await memberAuthHeader(app, m.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/devices',
      headers: admin,
      payload: { branchId: b.id, name: 'Front tablet' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; pairingCode: string; pairingExpiresAt: string };
    expect(body.pairingCode).toHaveLength(8);
    expect(new Date(body.pairingExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(body)).not.toContain('Hash');

    const pair = await app.inject({
      method: 'POST',
      url: '/v1/device/pair',
      payload: { code: body.pairingCode },
      remoteAddress: '203.0.113.21',
    });
    expect(pair.statusCode).toBe(200);

    const audit = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, body.id));
    expect(audit.map((a) => a.action).sort()).toEqual([
      'merchant_device.create',
      'merchant_device.pair',
    ]);
  });

  it('refuses a branch of another merchant and staff creating devices', async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const foreign = await createTestBranch(app, other.merchantId);
    const own = await createTestBranch(app, a.merchantId);
    const admin = await memberAuthHeader(app, a.userId);

    const cross = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/devices',
      headers: admin,
      payload: { branchId: foreign.id, name: 'X' },
    });
    expect(cross.statusCode).toBe(404);

    const staff = await createTestStaff(app, a.merchantId, own.id);
    const asStaff = await app.inject({
      method: 'POST',
      url: '/v1/merchant/org/devices',
      headers: staff.auth,
      payload: { branchId: own.id, name: 'X' },
    });
    expect(asStaff.statusCode).toBe(403);
  });

  it('lists all devices for the admin but only the own branch for staff, never leaking hashes', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    await createTestDevice(app, m.merchantId, b1.id);
    await createTestDevice(app, m.merchantId, b2.id);
    const staff = await createTestStaff(app, m.merchantId, b1.id);

    const adminList = await app.inject({
      method: 'GET',
      url: '/v1/merchant/org/devices',
      headers: await memberAuthHeader(app, m.userId),
    });
    expect(adminList.json()).toHaveLength(2);
    const staffList = await app.inject({
      method: 'GET',
      url: '/v1/merchant/org/devices',
      headers: staff.auth,
    });
    const rows = staffList.json() as Array<{ branchId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.branchId).toBe(b1.id);
    expect(JSON.stringify(rows)).not.toMatch(/Hash/);
  });

  it('PATCH renames, moves within the merchant, deactivates (device rejected next request) and audits', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    const foreign = await createTestBranch(app, (await createTestMerchant(app)).merchantId);
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const admin = await memberAuthHeader(app, m.userId);
    const patch = (payload: object) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/merchant/org/devices/${d.deviceId}`,
        headers: admin,
        payload,
      });

    expect((await patch({ name: 'Renamed', branchId: b2.id })).json()).toMatchObject({
      name: 'Renamed',
      branchId: b2.id,
    });
    expect((await patch({ branchId: foreign.id })).statusCode).toBe(404);
    expect((await patch({ isActive: false })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth })).statusCode,
    ).toBe(401);

    const audit = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, d.deviceId));
    // rename+move and the deactivate; the rolled-back foreign-branch attempt writes none.
    expect(audit.filter((a) => a.action === 'merchant_device.update').length).toBe(2);
  });

  async function openSessionOn(deviceAuth: Record<string, string>) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: deviceAuth,
      payload: { mode: 'kiosk' },
    });
    return (res.json() as { id: string }).id;
  }
  const endedAtOf = async (sessionId: string) =>
    (
      await app.db
        .select({ endedAt: schema.instoreSessions.endedAt })
        .from(schema.instoreSessions)
        .where(eq(schema.instoreSessions.id, sessionId))
    )[0]!.endedAt;

  it('moving a device to another branch ends its open sessions', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const sessionId = await openSessionOn(d.auth);
    expect(await endedAtOf(sessionId)).toBeNull();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/devices/${d.deviceId}`,
      headers: await memberAuthHeader(app, m.userId),
      payload: { branchId: b2.id },
    });
    expect(res.statusCode).toBe(200);
    expect(await endedAtOf(sessionId)).toBeInstanceOf(Date);
  });

  it('a rename alone leaves open sessions running', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const sessionId = await openSessionOn(d.auth);
    await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/devices/${d.deviceId}`,
      headers: await memberAuthHeader(app, m.userId),
      payload: { name: 'Renamed only' },
    });
    expect(await endedAtOf(sessionId)).toBeNull();
  });

  it('refuses moving a device to an inactive branch and leaves its session open', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const off = await createTestBranch(app, m.merchantId, { isActive: false });
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const sessionId = await openSessionOn(d.auth);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/devices/${d.deviceId}`,
      headers: await memberAuthHeader(app, m.userId),
      payload: { branchId: off.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('branch is inactive');
    expect(await endedAtOf(sessionId)).toBeNull();
  });

  it('deactivating a device ends its open sessions', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const sessionId = await openSessionOn(d.auth);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/devices/${d.deviceId}`,
      headers: await memberAuthHeader(app, m.userId),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(await endedAtOf(sessionId)).toBeInstanceOf(Date);
  });

  it('rejects a non-uuid device id with 400, not 500', async () => {
    const m = await createTestMerchant(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/merchant/org/devices/not-a-uuid',
      headers: await memberAuthHeader(app, m.userId),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const adminList = await app.inject({
      method: 'GET',
      url: '/admin/merchants/not-a-uuid/devices',
      headers: await adminAuthHeader(app, 'ADMIN'),
    });
    expect(adminList.statusCode).toBe(400);
  });

  it("cannot touch another merchant's device", async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const od = await createTestDevice(app, other.merchantId, ob.id);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/org/devices/${od.deviceId}`,
      headers: await memberAuthHeader(app, a.userId),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('admin device management', () => {
  it('ADMIN and SUPER_ADMIN can list and edit; MODERATOR and SUPPORT cannot edit', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    const base = `/admin/merchants/${m.merchantId}/devices`;

    const list = await app.inject({
      method: 'GET',
      url: base,
      headers: await adminAuthHeader(app, 'ADMIN'),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(1);

    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const ok = await app.inject({
        method: 'PATCH',
        url: `${base}/${d.deviceId}`,
        headers: await adminAuthHeader(app, role),
        payload: { name: `by ${role}` },
      });
      expect(ok.statusCode, role).toBe(200);
    }
    for (const role of ['MODERATOR', 'SUPPORT'] as const) {
      const no = await app.inject({
        method: 'PATCH',
        url: `${base}/${d.deviceId}`,
        headers: await adminAuthHeader(app, role),
        payload: { name: 'x' },
      });
      expect(no.statusCode, role).toBe(403);
    }
    const mismatch = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${(await createTestMerchant(app)).merchantId}/devices/${d.deviceId}`,
      headers: await adminAuthHeader(app, 'ADMIN'),
      payload: { name: 'x' },
    });
    expect(mismatch.statusCode).toBe(404);
  });
});
