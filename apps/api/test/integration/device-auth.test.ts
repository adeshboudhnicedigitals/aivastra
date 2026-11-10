import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePairingCode, sha256 } from '../../src/modules/device/secrets';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant } from '../helpers/merchant';

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

async function pendingDevice(merchantId: string, branchId: string, minutes = 15) {
  const code = generatePairingCode();
  const [d] = await app.db
    .insert(schema.merchantDevices)
    .values({
      merchantId,
      branchId,
      name: 'Pending',
      pairingCodeHash: sha256(code),
      pairingExpiresAt: new Date(Date.now() + minutes * 60_000),
    })
    .returning();
  return { code, deviceId: d!.id };
}

describe('device pairing', () => {
  it('exchanges a code for a one-time token that then authenticates', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const { code, deviceId } = await pendingDevice(m.merchantId, b.id);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/pair',
      payload: { code },
      remoteAddress: '203.0.113.11',
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token.startsWith('dvc_')).toBe(true);

    const [row] = await app.db
      .select()
      .from(schema.merchantDevices)
      .where(eq(schema.merchantDevices.id, deviceId));
    expect(row!.deviceTokenHash).toBe(sha256(token));
    expect(row!.pairingCodeHash).toBeNull();

    const me = await app.inject({
      method: 'GET',
      url: '/v1/device/me',
      headers: { authorization: `Device ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ deviceId, merchantId: m.merchantId, branchId: b.id });
  });

  it('refuses a reused code, an expired code and an unknown code with the same 400', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const fresh = await pendingDevice(m.merchantId, b.id);
    const expired = await pendingDevice(m.merchantId, b.id, -1);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/device/pair',
      payload: { code: fresh.code },
      remoteAddress: '203.0.113.12',
    });
    expect(ok.statusCode).toBe(200);

    for (const code of [fresh.code, expired.code, 'ZZZZZZZZ']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/pair',
        payload: { code },
        remoteAddress: '203.0.113.12',
      });
      expect(res.statusCode, code).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAIRING_CODE');
    }
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const { code } = await pendingDevice(m.merchantId, b.id);
    const claim = () =>
      app.inject({
        method: 'POST',
        url: '/v1/device/pair',
        payload: { code },
        remoteAddress: '203.0.113.13',
      });
    const results = await Promise.all([claim(), claim()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  });

  it('rate-limits pairing attempts per IP', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/pair',
        payload: { code: 'ABCDEFGH' },
        remoteAddress: '203.0.113.14',
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('requireDevice', () => {
  it('rejects a missing, malformed or unknown token', async () => {
    for (const headers of [{}, { authorization: 'Bearer x' }, { authorization: 'Device nope' }]) {
      const res = await app.inject({ method: 'GET', url: '/v1/device/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('DEVICE_INACTIVE');
    }
  });

  it('rejects the very next request after the device, its branch or its merchant is deactivated', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    const get = () => app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth });
    expect((await get()).statusCode).toBe(200);

    await app.db
      .update(schema.merchantBranches)
      .set({ isActive: false })
      .where(eq(schema.merchantBranches.id, b.id));
    expect((await get()).statusCode).toBe(401);
    await app.db
      .update(schema.merchantBranches)
      .set({ isActive: true })
      .where(eq(schema.merchantBranches.id, b.id));
    expect((await get()).statusCode).toBe(200);

    await app.db
      .update(schema.merchants)
      .set({ isActive: false })
      .where(eq(schema.merchants.id, m.merchantId));
    expect((await get()).statusCode).toBe(401);
    await app.db
      .update(schema.merchants)
      .set({ isActive: true })
      .where(eq(schema.merchants.id, m.merchantId));

    await app.db
      .update(schema.merchantDevices)
      .set({ isActive: false })
      .where(eq(schema.merchantDevices.id, d.deviceId));
    expect((await get()).statusCode).toBe(401);
  });

  it('records last_seen_at', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    await app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth });
    const [row] = await app.db
      .select()
      .from(schema.merchantDevices)
      .where(eq(schema.merchantDevices.id, d.deviceId));
    expect(row!.lastSeenAt).toBeInstanceOf(Date);
  });
});
