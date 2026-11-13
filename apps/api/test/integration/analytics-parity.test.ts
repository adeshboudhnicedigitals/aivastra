import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAnalyticsRollupTick } from '../../src/modules/analytics/rollup';
import { localDate, parseWindow } from '../../src/modules/merchant/analytics/params';
import { itemTotals, sessionTotals } from '../../src/modules/merchant/analytics/queries';
import type { AnalyticsScope } from '../../src/modules/merchant/analytics/scope';
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
  stageCustomerPhoto,
} from '../helpers/merchant';

// Analytics phase 1, plan Task 6: the gate for any future switch of the dashboard onto
// rollups (plan D2). Activity is driven through the real device routes, so the events are
// the ones production writes; the bucket totals must equal what queries.ts reports from the
// source tables for the same window and scope. Sold is net: sale_recorded − sale_voided.

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

describe('rollup parity with the source-table dashboard', () => {
  it('sessions, tried, wishlisted and net sold agree, whole merchant and per branch/staff', async () => {
    const m = await createTestMerchant(app, { balance: 500 });
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    const d1 = await createTestDevice(app, m.merchantId, b1.id);
    const d2 = await createTestDevice(app, m.merchantId, b2.id);
    const s1 = await createTestStaff(app, m.merchantId, b1.id);
    const s2 = await createTestStaff(app, m.merchantId, b2.id);
    const gt = await createTestGarmentType(app);
    const item = await createTestCatalogItem(app, m.merchantId, gt.id);

    type Dev = typeof d1;
    type Staff = typeof s1;
    const start = async (d: Dev, staff: Staff | null) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/sessions',
        headers: {
          ...d.auth,
          ...(staff ? { 'x-staff-authorization': staff.auth.authorization } : {}),
        },
        payload: { mode: staff ? 'assisted' : 'kiosk' },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    };
    const add = async (d: Dev, sid: string, action: 'wishlisted' | 'sold') => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/device/sessions/${sid}/items`,
        headers: d.auth,
        payload: { catalogItemId: item.id, action },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    };
    const tryOn = async (d: Dev, sid: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/tryon/jobs',
        headers: d.auth,
        payload: {
          sessionId: sid,
          merchantCatalogItemId: item.id,
          customerPhotoKey: await stageCustomerPhoto(app, m.merchantId),
        },
      });
      expect(res.statusCode).toBe(201);
    };

    // Branch 1: one assisted session with a try-on, a wishlist, two sales (one undone by the
    // seller) and a kiosk session with a try-on and a wishlist.
    const a = await start(d1, s1);
    await tryOn(d1, a);
    await add(d1, a, 'wishlisted');
    const sold1 = await add(d1, a, 'sold');
    await add(d1, a, 'sold');
    const undo = await app.inject({
      method: 'DELETE',
      url: `/v1/device/sessions/${a}/items/${sold1}`,
      headers: { ...d1.auth, 'x-staff-authorization': s1.auth.authorization },
    });
    expect(undo.statusCode).toBe(200);
    const k = await start(d1, null);
    await tryOn(d1, k);
    await add(d1, k, 'wishlisted');
    // Branch 2: an assisted session with a sale the merchant admin voids, and one kept.
    const b = await start(d2, s2);
    await tryOn(d2, b);
    const sold2 = await add(d2, b, 'sold');
    await add(d2, b, 'sold');
    const voided = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/session-items/${sold2}/void`,
      headers: await memberAuthHeader(app, m.userId),
    });
    expect(voided.statusCode).toBe(200);

    await runAnalyticsRollupTick(app, { lagSeconds: 0 });

    // Yesterday..today in IST, so a run straddling local midnight still has everything inside.
    const now = new Date();
    const today = localDate(now, 'Asia/Kolkata');
    const yesterday = localDate(new Date(now.getTime() - 86_400_000), 'Asia/Kolkata');
    const w = parseWindow({ from: yesterday, to: today }, now);

    const bucketTotals = async (scope: AnalyticsScope) => {
      const rows = await app.db.execute<{ event: string; n: string }>(sql`
        select event, sum(count) as n from analytics_buckets b
        where b.merchant_id = ${scope.merchantId}
          ${scope.branchId ? sql`and b.branch_id = ${scope.branchId}` : sql``}
          ${scope.staffId ? sql`and b.staff_id = ${scope.staffId}` : sql``}
          and bucket_start >= ${w.startUtc.toISOString()}::timestamptz
          and bucket_start < ${w.endUtc.toISOString()}::timestamptz
        group by event
      `);
      const by = (e: string) => Number(rows.find((r) => r.event === e)?.n ?? 0);
      return {
        sessions: by('session_started'),
        tried: by('tryon_requested'),
        wishlisted: by('item_wishlisted'),
        sold: by('sale_recorded') - by('sale_voided'),
      };
    };
    const sourceTotals = async (scope: AnalyticsScope) => {
      const [s, i] = await Promise.all([
        sessionTotals(app.db, scope, w),
        itemTotals(app.db, scope, w),
      ]);
      return { sessions: s.sessions, tried: i.tried, wishlisted: i.wishlisted, sold: i.sold };
    };

    const base = { merchantId: m.merchantId, isStaff: false, memberStaffId: null };
    const scopes: AnalyticsScope[] = [
      base,
      { ...base, branchId: b1.id },
      { ...base, branchId: b2.id },
      { ...base, staffId: s1.staffId },
      { ...base, staffId: s2.staffId },
    ];
    const whole = await sourceTotals(base);
    // Hand count: 3 sessions, 3 try-ons, 2 wishlists, 4 sales − 2 voids.
    expect(whole).toEqual({ sessions: 3, tried: 3, wishlisted: 2, sold: 2 });
    for (const scope of scopes) {
      expect(await bucketTotals(scope), JSON.stringify(scope)).toEqual(await sourceTotals(scope));
    }
  });
});
