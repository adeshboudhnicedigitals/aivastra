import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvents } from '../../src/modules/analytics/record.js';
import { runAnalyticsRollupTick } from '../../src/modules/analytics/rollup.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  memberAuthHeader,
} from '../helpers/merchant.js';

// Account console: GET /admin/analytics/overview (all accounts) and the per-account heatmap.
// The overview has its own SQL, so the key test is parity with the per-account summaries.

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
// 2026-10-01 05:00Z = 10:30 IST; the window is the whole of October 1-3 in IST.
const RANGE = 'from=2026-10-01&to=2026-10-03&tz=Asia/Kolkata';

async function account(opts: {
  name: string;
  sessions: string[];
  sold: number;
  tried: number;
  credits: number;
}) {
  const m = await createTestMerchant(app, { balance: 100 });
  await app.db
    .update(schema.merchants)
    .set({ companyName: opts.name })
    .where(eq(schema.merchants.id, m.merchantId));
  const b = await createTestBranch(app, m.merchantId);
  const d = await createTestDevice(app, m.merchantId, b.id);
  const ids: string[] = [];
  for (const at of opts.sessions) {
    const [row] = await app.db
      .insert(schema.instoreSessions)
      .values({
        merchantId: m.merchantId,
        branchId: b.id,
        deviceId: d.deviceId,
        staffId: null,
        mode: 'kiosk',
        startedAt: new Date(at),
        lastActivityAt: new Date(at),
      })
      .returning();
    ids.push(row!.id);
  }
  const first = ids[0]!;
  const item = async (action: 'tried' | 'sold', n: number, voided = false) => {
    for (let i = 0; i < n; i++) {
      await app.db.insert(schema.sessionItems).values({
        sessionId: first,
        catalogItemId: crypto.randomUUID(),
        action,
        staffId: null,
        voidedAt: voided ? new Date('2026-10-05T00:00:00Z') : null,
      });
    }
  };
  await item('tried', opts.tried);
  await item('sold', opts.sold);
  await item('sold', 1, true); // voided: counts nowhere
  await app.db.insert(schema.jobs).values({
    merchantId: m.merchantId,
    creditsCharged: opts.credits,
    createdAt: new Date(opts.sessions[0]!),
    sessionId: first,
    branchId: b.id,
    deviceId: d.deviceId,
    status: 'COMPLETED',
  });
  return { ...m, branchId: b.id, deviceId: d.deviceId };
}

describe('GET /admin/analytics/overview', () => {
  it('totals equal the sum of the per-account summaries, and ranks the busiest account first', async () => {
    const a = await account({
      name: 'Alpha Retail',
      sessions: ['2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', '2026-10-02T06:00:00Z'],
      sold: 2,
      tried: 3,
      credits: 7,
    });
    const b = await account({
      name: 'Beta Stores',
      sessions: ['2026-10-01T05:00:00Z'],
      sold: 1,
      tried: 1,
      credits: 4,
    });
    const auth = await adminAuthHeader(app, 'ADMIN');

    const res = await get(`/admin/analytics/overview?${RANGE}`, auth);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    let sessions = 0;
    let tried = 0;
    let sold = 0;
    let credits = 0;
    for (const m of [a, b]) {
      const s = (
        await get(`/admin/accounts/${m.merchantId}/analytics/summary?${RANGE}`, auth)
      ).json();
      sessions += s.sessions;
      tried += s.tried;
      sold += s.sold;
      credits += s.creditsSpent;
    }
    // Other test files share this database only per file, so the two accounts are all there is.
    expect(body.totals).toEqual({
      activeAccounts: 2,
      sessions,
      tried,
      sold,
      creditsSpent: credits,
    });
    expect(body.totals).toMatchObject({ sessions: 4, tried: 4, sold: 3, creditsSpent: 11 });

    expect(body.points).toHaveLength(3);
    expect(body.points.reduce((x: number, p: { sessions: number }) => x + p.sessions, 0)).toBe(4);
    expect(body.top.map((r: { companyName: string }) => r.companyName)).toEqual([
      'Alpha Retail',
      'Beta Stores',
    ]);
    expect(body.top[0]).toMatchObject({ sessions: 3, tried: 3, sold: 2, creditsSpent: 7 });
  });

  it('needs accounts.read: merchant tokens and SUPPORT are refused', async () => {
    const m = await createTestMerchant(app);
    const url = `/admin/analytics/overview?${RANGE}`;
    expect((await get(url, await memberAuthHeader(app, m.userId))).statusCode).toBe(401);
    expect((await get(url, await adminAuthHeader(app, 'SUPPORT'))).statusCode).toBe(403);
  });
});

describe('GET /admin/accounts/:id/analytics/heatmap', () => {
  it('returns 168 cells for the named account only', async () => {
    const a = await account({
      name: 'Heat A',
      sessions: ['2026-10-01T05:00:00Z'],
      sold: 0,
      tried: 0,
      credits: 1,
    });
    const b = await account({
      name: 'Heat B',
      sessions: ['2026-10-01T05:00:00Z'],
      sold: 0,
      tried: 0,
      credits: 1,
    });
    await recordEvents(app.db, [
      {
        event: 'session_started',
        merchantId: a.merchantId,
        branchId: a.branchId,
        deviceId: a.deviceId,
        channel: 'kiosk',
        occurredAt: new Date('2026-10-01T05:00:00Z'),
      },
      {
        event: 'session_started',
        merchantId: b.merchantId,
        branchId: b.branchId,
        deviceId: b.deviceId,
        channel: 'kiosk',
        occurredAt: new Date('2026-10-01T05:10:00Z'),
      },
    ]);
    await runAnalyticsRollupTick(app, { lagSeconds: 0 });
    const auth = await adminAuthHeader(app);
    const res = await get(`/admin/accounts/${a.merchantId}/analytics/heatmap?${RANGE}`, auth);
    expect(res.statusCode).toBe(200);
    const cells = res.json().cells as { value: number }[];
    expect(cells).toHaveLength(168);
    expect(cells.reduce((x, y) => x + y.value, 0)).toBe(1); // not B's event
    const missing = await get(
      `/admin/accounts/00000000-0000-4000-8000-000000000000/analytics/heatmap?${RANGE}`,
      auth,
    );
    expect(missing.statusCode).toBe(404);
  });
});

describe('GET /admin/accounts/:id/insights/*', () => {
  const NAMES = ['funnel', 'lost-demand', 'out-of-stock', 'reliability'];

  it("returns what the merchant's own Insights screen returns for that account", async () => {
    const a = await account({
      name: 'Insight A',
      sessions: ['2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z'],
      sold: 1,
      tried: 2,
      credits: 3,
    });
    const admin = await adminAuthHeader(app);
    const owner = await memberAuthHeader(app, a.userId);
    for (const name of NAMES) {
      const viaConsole = await get(
        `/admin/accounts/${a.merchantId}/insights/${name}?${RANGE}`,
        admin,
      );
      const viaMerchant = await get(`/v1/merchant/insights/${name}?${RANGE}`, owner);
      expect(viaConsole.statusCode).toBe(200);
      expect(viaConsole.json()).toEqual(viaMerchant.json());
    }
    expect(
      (await get(`/admin/accounts/${a.merchantId}/insights/funnel?${RANGE}`, admin)).json(),
    ).toMatchObject({
      sessions: 2,
    });
  });

  it('narrows to one branch when branchId is given', async () => {
    const a = await account({
      name: 'Insight Branches',
      sessions: ['2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z'],
      sold: 0,
      tried: 1,
      credits: 0,
    });
    const other = await createTestBranch(app, a.merchantId);
    const od = await createTestDevice(app, a.merchantId, other.id);
    await app.db.insert(schema.instoreSessions).values({
      merchantId: a.merchantId,
      branchId: other.id,
      deviceId: od.deviceId,
      staffId: null,
      mode: 'kiosk',
      startedAt: new Date('2026-10-03T05:00:00Z'),
      lastActivityAt: new Date('2026-10-03T05:00:00Z'),
    });
    const admin = await adminAuthHeader(app);
    const all = await get(`/admin/accounts/${a.merchantId}/insights/funnel?${RANGE}`, admin);
    const one = await get(
      `/admin/accounts/${a.merchantId}/insights/funnel?${RANGE}&branchId=${other.id}`,
      admin,
    );
    expect(all.json()).toMatchObject({ sessions: 3 });
    expect(one.json()).toMatchObject({ sessions: 1 });
  });

  it('needs accounts.read and a real account', async () => {
    const m = await createTestMerchant(app);
    for (const name of NAMES) {
      const url = `/admin/accounts/${m.merchantId}/insights/${name}?${RANGE}`;
      expect((await get(url, await memberAuthHeader(app, m.userId))).statusCode).toBe(401);
      expect((await get(url, await adminAuthHeader(app, 'SUPPORT'))).statusCode).toBe(403);
    }
    const missing = await get(
      `/admin/accounts/00000000-0000-4000-8000-000000000000/insights/funnel?${RANGE}`,
      await adminAuthHeader(app),
    );
    expect(missing.statusCode).toBe(404);
  });
});
