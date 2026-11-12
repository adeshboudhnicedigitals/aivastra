import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant, memberAuthHeader } from '../helpers/merchant.js';

// Account console phase 2: /admin/accounts/:id/analytics/*.

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
const RANGE = 'from=2026-11-01&to=2026-11-12&tz=Asia/Kolkata';

describe('GET /admin/accounts/:id/analytics/*', () => {
  it('returns the named account figures, including the wallet staff never see', async () => {
    const m = await createTestMerchant(app, { balance: 321 });
    const auth = await adminAuthHeader(app, 'ADMIN');
    const res = await get(`/admin/accounts/${m.merchantId}/analytics/summary?${RANGE}`, auth);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sessions: 0, sold: 0, creditsBalance: 321 });

    const ts = await get(`/admin/accounts/${m.merchantId}/analytics/timeseries?${RANGE}`, auth);
    expect(ts.statusCode).toBe(200);
    expect(Array.isArray(ts.json().points)).toBe(true);

    const bd = await get(
      `/admin/accounts/${m.merchantId}/analytics/breakdown?${RANGE}&by=branch`,
      auth,
    );
    expect(bd.statusCode).toBe(200);
    expect(bd.json().by).toBe('branch');
  });

  it('is scoped to the path merchant: another merchant balance never leaks in', async () => {
    const a = await createTestMerchant(app, { balance: 111 });
    const b = await createTestMerchant(app, { balance: 999 });
    const auth = await adminAuthHeader(app);
    const res = await get(`/admin/accounts/${a.merchantId}/analytics/summary?${RANGE}`, auth);
    expect(res.json().creditsBalance).toBe(111);
    const other = await get(`/admin/accounts/${b.merchantId}/analytics/summary?${RANGE}`, auth);
    expect(other.json().creditsBalance).toBe(999);
  });

  it('404 for an unknown account', async () => {
    const res = await get(
      `/admin/accounts/00000000-0000-4000-8000-000000000000/analytics/summary?${RANGE}`,
      await adminAuthHeader(app),
    );
    expect(res.statusCode).toBe(404);
  });

  it('needs accounts.read: merchant tokens and SUPPORT are refused', async () => {
    const m = await createTestMerchant(app);
    const url = `/admin/accounts/${m.merchantId}/analytics/summary?${RANGE}`;
    expect((await get(url, await memberAuthHeader(app, m.userId))).statusCode).toBe(401);
    expect((await get(url, await adminAuthHeader(app, 'SUPPORT'))).statusCode).toBe(403);
  });
});
