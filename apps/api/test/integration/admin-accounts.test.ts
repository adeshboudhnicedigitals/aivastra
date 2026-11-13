import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  memberAuthHeader,
} from '../helpers/merchant.js';

// Account console phase 1: GET /admin/accounts.

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

const get = (url: string, headers: Record<string, string>) =>
  app.inject({ method: 'GET', url, headers });

describe('GET /admin/accounts', () => {
  it('reports balance, branches, devices, offline devices and channels per merchant', async () => {
    const m = await createTestMerchant(app, { balance: 42 });
    await app.db
      .update(schema.merchants)
      .set({ companyName: 'Zephyr Textiles Unique' })
      .where((await import('drizzle-orm')).eq(schema.merchants.id, m.merchantId));
    const branch = await createTestBranch(app, m.merchantId);
    await createTestDevice(app, m.merchantId, branch.id);
    const stale = await createTestDevice(app, m.merchantId, branch.id);
    await app.db
      .update(schema.merchantDevices)
      .set({ lastSeenAt: new Date(Date.now() - 10 * 86_400_000) })
      .where((await import('drizzle-orm')).eq(schema.merchantDevices.id, stale.deviceId));

    const res = await get('/admin/accounts?search=Zephyr%20Textiles', await adminAuthHeader(app));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      merchantId: m.merchantId,
      creditBalance: 42,
      branches: 1,
      devices: 2,
      devicesOffline: 2, // one never seen, one seen 10 days ago
      burn30d: 0,
      channels: { inStore: true, shopify: false, apiKey: false },
    });
  });

  it('filters by active, sorts, and pages', async () => {
    const a = await createTestMerchant(app, { isActive: false });
    await createTestMerchant(app);
    const auth = await adminAuthHeader(app);
    const inactive = (await get('/admin/accounts?active=false&limit=100', auth)).json();
    expect(inactive.items.some((i: { merchantId: string }) => i.merchantId === a.merchantId)).toBe(
      true,
    );
    expect(inactive.items.every((i: { isActive: boolean }) => !i.isActive)).toBe(true);
    const p1 = (await get('/admin/accounts?limit=1&sort=balance', auth)).json();
    expect(p1.items).toHaveLength(1);
    expect(p1.total).toBeGreaterThan(1);
  });

  it('needs accounts.read: a merchant user token and a role without it are refused', async () => {
    const m = await createTestMerchant(app);
    expect((await get('/admin/accounts', await memberAuthHeader(app, m.userId))).statusCode).toBe(
      401,
    );
    expect((await get('/admin/accounts', await adminAuthHeader(app, 'SUPPORT'))).statusCode).toBe(
      403,
    );
    expect((await get('/admin/accounts', await adminAuthHeader(app, 'ADMIN'))).statusCode).toBe(
      200,
    );
  });
});
