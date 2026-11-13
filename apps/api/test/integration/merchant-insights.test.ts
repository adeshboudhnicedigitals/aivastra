import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestCatalogItem,
  createTestDevice,
  createTestGarmentType,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// Merchant Insights: every figure is hand-computed from the fixture below (arithmetic next to
// each expectation). IST window 1-3 Oct 2026; sessions start 2026-10-01T05:00Z (10:30 IST).

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

const W = 'from=2026-10-01&to=2026-10-03&tz=Asia/Kolkata';
const IN = '2026-10-01T05:00:00Z';
const get = (url: string, headers: Record<string, string>) =>
  app.inject({ method: 'GET', url, headers });

async function fixture() {
  const m = await createTestMerchant(app, { balance: 100 });
  const b1 = await createTestBranch(app, m.merchantId);
  const b2 = await createTestBranch(app, m.merchantId);
  const d1 = await createTestDevice(app, m.merchantId, b1.id);
  const d2 = await createTestDevice(app, m.merchantId, b2.id);
  const staff = await createTestStaff(app, m.merchantId, b1.id);
  const gt = await createTestGarmentType(app);
  const itemA = await createTestCatalogItem(app, m.merchantId, gt.id); // "Red Shirt", offer 180000
  const itemB = await createTestCatalogItem(app, m.merchantId, gt.id);

  const variant = async (catalogItemId: string, size: string, colour: string) =>
    (
      await app.db
        .insert(schema.merchantCatalogVariants)
        .values({ merchantId: m.merchantId, catalogItemId, size, colour })
        .returning()
    )[0]!;
  const vAM = await variant(itemA.id, 'M', 'Red');
  const vAL = await variant(itemA.id, 'L', 'Red');
  const vBS = await variant(itemB.id, 'S', '');

  const session = async (branchId: string, deviceId: string, at = IN, merchantId = m.merchantId) =>
    (
      await app.db
        .insert(schema.instoreSessions)
        .values({
          merchantId,
          branchId,
          deviceId,
          staffId: null,
          mode: 'kiosk',
          startedAt: new Date(at),
          lastActivityAt: new Date(at),
        })
        .returning()
    )[0]!.id;
  const item = (
    sessionId: string,
    catalogItemId: string,
    action: 'tried' | 'sold',
    voided = false,
  ) =>
    app.db.insert(schema.sessionItems).values({
      sessionId,
      catalogItemId,
      action,
      staffId: null,
      voidedAt: voided ? new Date('2026-10-05T00:00:00Z') : null,
    });
  const cart = async (
    sessionId: string,
    branchId: string,
    status: 'open' | 'billed' | 'abandoned',
    lines: {
      variantId: string;
      catalogItemId: string;
      quantity: number;
      removed?: boolean;
      billed?: boolean;
    }[],
  ) => {
    const [ca] = await app.db
      .insert(schema.carts)
      .values({
        merchantId: m.merchantId,
        branchId,
        sessionId,
        cartCode: randomUUID().slice(0, 8),
        status,
      })
      .returning();
    for (const l of lines) {
      await app.db.insert(schema.cartLines).values({
        cartId: ca!.id,
        merchantId: m.merchantId,
        variantId: l.variantId,
        catalogItemId: l.catalogItemId,
        quantity: l.quantity,
        addedBy: 'shopper',
        removedAt: l.removed ? new Date(IN) : null,
        billedAt: l.billed ? new Date(IN) : null,
      });
    }
  };

  // B1: six sessions s1..s6, all try itemA; itemB tried in s1, s2 (2 tries, below the minimum).
  const s = [];
  for (let i = 0; i < 6; i++) s.push(await session(b1.id, d1.deviceId));
  for (const id of s) await item(id, itemA.id, 'tried');
  await item(s[0]!, itemB.id, 'tried');
  await item(s[1]!, itemB.id, 'tried');
  await item(s[0]!, itemA.id, 'sold');
  await item(s[0]!, itemA.id, 'sold');
  await item(s[1]!, itemA.id, 'sold', true); // voided: counts nowhere
  // B2: one session, tries itemA.
  const t1 = await session(b2.id, d2.deviceId);
  await item(t1, itemA.id, 'tried');
  // Outside the window (30 Sep): ignored everywhere.
  const old = await session(b1.id, d1.deviceId, '2026-09-30T05:00:00Z');
  await item(old, itemA.id, 'tried');

  // Carts. s1 billed (qty 2 M/Red, plus a removed L line); s2 abandoned (1 M/Red);
  // s3 open (1 B/S); s4 abandoned but its only line was removed → not a cart at all.
  await cart(s[0]!, b1.id, 'billed', [
    { variantId: vAM.id, catalogItemId: itemA.id, quantity: 2, billed: true },
    { variantId: vAL.id, catalogItemId: itemA.id, quantity: 1, removed: true },
  ]);
  await cart(s[1]!, b1.id, 'abandoned', [
    { variantId: vAM.id, catalogItemId: itemA.id, quantity: 1 },
  ]);
  await cart(s[2]!, b1.id, 'open', [{ variantId: vBS.id, catalogItemId: itemB.id, quantity: 1 }]);
  await cart(s[3]!, b1.id, 'abandoned', [
    { variantId: vAL.id, catalogItemId: itemA.id, quantity: 1, removed: true },
  ]);

  // Out of stock: L at B1 refused twice and viewed 3x; B2 viewed once; one junk variantId.
  const ev = (
    event: string,
    branchId: string,
    deviceId: string,
    catalogItemId: string,
    variantId: string,
  ) =>
    app.db.insert(schema.analyticsEvents).values({
      event,
      merchantId: m.merchantId,
      branchId,
      deviceId,
      catalogItemId,
      occurredAt: new Date(IN),
      props: { variantId },
    });
  for (let i = 0; i < 2; i++) await ev('cart_refused_oos', b1.id, d1.deviceId, itemA.id, vAL.id);
  for (let i = 0; i < 3; i++) await ev('oos_viewed', b1.id, d1.deviceId, itemA.id, vAL.id);
  await ev('oos_viewed', b2.id, d2.deviceId, itemA.id, vAL.id);
  await ev('oos_viewed', b1.id, d1.deviceId, itemB.id, 'not-a-uuid');

  // Stock: B1 manual rows 30 days old (stale); B2 manual row fresh.
  const old30 = new Date(Date.now() - 30 * 86_400_000);
  for (const v of [vAM, vAL])
    await app.db.insert(schema.variantBranchStock).values({
      merchantId: m.merchantId,
      variantId: v.id,
      branchId: b1.id,
      status: 'out',
      source: 'manual',
      updatedAt: old30,
    });
  await app.db.insert(schema.variantBranchStock).values({
    merchantId: m.merchantId,
    variantId: vAM.id,
    branchId: b2.id,
    status: 'in_stock',
    source: 'manual',
  });

  // Jobs at B1 (session-attributed): 3 completed (waits 10s/20s/30s, 2 credits each), one
  // FAILED and refunded (5 credits), one still queued (2 credits).
  const job = async (status: string, credits: number, waitS?: number) =>
    (
      await app.db
        .insert(schema.jobs)
        .values({
          merchantId: m.merchantId,
          creditsCharged: credits,
          createdAt: new Date(IN),
          completedAt: waitS ? new Date(new Date(IN).getTime() + waitS * 1000) : null,
          sessionId: s[0]!,
          branchId: b1.id,
          deviceId: d1.deviceId,
          status,
        })
        .returning()
    )[0]!.id;
  for (const w of [10, 20, 30]) await job('COMPLETED', 2, w);
  const failedId = await job('FAILED', 5);
  await app.db.insert(schema.creditLedger).values({
    userId: m.userId,
    delta: 5,
    reason: 'JOB_FAIL_REFUND',
    jobId: failedId,
  });
  await job('QUEUED', 2);

  // Another merchant with activity in the same window must never leak in.
  const other = await createTestMerchant(app);
  const ob = await createTestBranch(app, other.merchantId);
  const od = await createTestDevice(app, other.merchantId, ob.id);
  const os = await session(ob.id, od.deviceId, IN, other.merchantId);
  for (let i = 0; i < 9; i++) await item(os, itemA.id, 'tried');

  return { m, b1, b2, staff, itemA, itemB, owner: await memberAuthHeader(app, m.userId) };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});

describe('insights funnel', () => {
  it('counts sessions that reached each step, all branches', async () => {
    const r = (await get(`/v1/merchant/insights/funnel?${W}`, f.owner)).json();
    // sessions: 6 (B1) + 1 (B2) = 7; tried: all 7 sessions tried; carted: s1,s2,s3 (s4's only
    // line was removed); billed: s1 only. Carts: 1 billed, 1 abandoned, 1 open.
    expect(r).toMatchObject({
      sessions: 7,
      tried: 7,
      carted: 3,
      billed: 1,
      carts: { billed: 1, abandoned: 1, open: 1 },
      abandonmentRate: 0.5,
    });
  });

  it('agrees with the dashboard summary for the same window', async () => {
    const sum = (await get(`/v1/merchant/analytics/summary?${W}`, f.owner)).json();
    const r = (await get(`/v1/merchant/insights/funnel?${W}`, f.owner)).json();
    expect(r.sessions).toBe(sum.sessions);
  });

  it('narrows to a branch for admin, and forces staff to their own branch', async () => {
    const one = (
      await get(`/v1/merchant/insights/funnel?${W}&branchId=${f.b1.id}`, f.owner)
    ).json();
    expect(one.sessions).toBe(6);
    const staff = await get(`/v1/merchant/insights/funnel?${W}`, f.staff.auth);
    expect(staff.json().sessions).toBe(6);
    const foreign = await get(
      `/v1/merchant/insights/funnel?${W}&branchId=${f.b2.id}`,
      f.staff.auth,
    );
    expect(foreign.statusCode).toBe(403);
  });

  it('refuses unauthenticated callers and rejects a bad date', async () => {
    expect((await get(`/v1/merchant/insights/funnel?${W}`, {})).statusCode).toBe(401);
    expect((await get('/v1/merchant/insights/funnel?from=nope', f.owner)).statusCode).toBe(400);
  });
});

describe('insights lost demand', () => {
  it('lists only items at or above the minimum tries, with hand-computed rates', async () => {
    const r = (await get(`/v1/merchant/insights/lost-demand?${W}`, f.owner)).json();
    // itemA: tried 7 (6 B1 + 1 B2; the 30 Sep try and the other merchant's 9 are excluded),
    // sold 2 (a voided one is not), carted 2 + 1 (the removed L lines are not). itemB: 2 tries.
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      catalogItemId: f.itemA.id,
      name: 'Red Shirt',
      pricePaise: 180000,
      tried: 7,
      carted: 3,
      sold: 2,
    });
    expect(r.items[0].rate).toBeCloseTo(2 / 7);
    // Size/colour start at the cart: M carted 3 (2 billed), S carted 1; L only had removed lines.
    expect(r.bySize).toEqual([
      { label: 'M', carted: 3, sold: 2 },
      { label: 'S', carted: 1, sold: 0 },
    ]);
    expect(r.byColour).toEqual([
      { label: 'Red', carted: 3, sold: 2 },
      { label: '', carted: 1, sold: 0 },
    ]);
  });

  it('honours minTries and the staff branch scope', async () => {
    const low = (await get(`/v1/merchant/insights/lost-demand?${W}&minTries=2`, f.owner)).json();
    expect(low.items.map((i: { tried: number }) => i.tried)).toEqual([7, 2]);
    const staff = (await get(`/v1/merchant/insights/lost-demand?${W}`, f.staff.auth)).json();
    expect(staff.items[0].tried).toBe(6); // B1 only
  });
});

describe('insights out of stock', () => {
  it('separates the server-counted refusals from device-reported views', async () => {
    const r = (await get(`/v1/merchant/insights/out-of-stock?${W}`, f.owner)).json();
    const b1 = r.rows.find(
      (x: { branchId: string; size: string }) => x.branchId === f.b1.id && x.size === 'L',
    );
    expect(b1).toMatchObject({ refused: 2, views: 3, colour: 'Red', branchName: f.b1.name });
    const b2 = r.rows.find((x: { branchId: string }) => x.branchId === f.b2.id);
    expect(b2).toMatchObject({ refused: 0, views: 1 });
    // A junk variantId is a row with no size, never an error.
    expect(
      r.rows.some((x: { size: string; views: number }) => x.size === '' && x.views === 1),
    ).toBe(true);
    expect(r.rows[0].refused).toBe(2); // refused first
  });

  it('flags only branches whose manual stock is older than the threshold', async () => {
    const r = (await get(`/v1/merchant/insights/out-of-stock?${W}`, f.owner)).json();
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0]).toMatchObject({ branchId: f.b1.id, variants: 2 });
    const loose = (
      await get(`/v1/merchant/insights/out-of-stock?${W}&staleDays=60`, f.owner)
    ).json();
    expect(loose.stale).toHaveLength(0);
  });

  it('shows staff only their own branch', async () => {
    const r = (await get(`/v1/merchant/insights/out-of-stock?${W}`, f.staff.auth)).json();
    expect(r.rows.every((x: { branchId: string }) => x.branchId === f.b1.id)).toBe(true);
  });
});

describe('insights reliability', () => {
  it('computes failure rate, wait percentiles and cost per try-on / sale', async () => {
    const r = (
      await get(`/v1/merchant/insights/reliability?${W}&branchId=${f.b1.id}`, f.owner)
    ).json();
    // finished = 3 completed + 1 failed = 4 (the queued job is unfinished); rate 1/4.
    // waits 10s/20s/30s → p50 20000, p90 = 20s + 0.8×10s = 28000.
    // spent = 3×2 + 2 (queued) = 8; the failed 5 was refunded. tried 8 (6 itemA + 2 itemB), sold 2 at B1.
    expect(r).toMatchObject({ finished: 4, failed: 1, failureRate: 0.25 });
    expect(r.waitMs).toEqual({ p50: 20000, p90: 28000 });
    expect(r.creditsPerTryon).toBe(1);
    expect(r.creditsPerSale).toBe(4);
  });

  it('returns nulls, not NaN, when there is nothing to divide', async () => {
    const empty = await createTestMerchant(app);
    const h = await memberAuthHeader(app, empty.userId);
    const r = (await get(`/v1/merchant/insights/reliability?${W}`, h)).json();
    expect(r).toMatchObject({
      finished: 0,
      failureRate: null,
      waitMs: { p50: null, p90: null },
      creditsPerTryon: null,
      creditsPerSale: null,
    });
  });
});
