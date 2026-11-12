import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCartAbandonTick } from '../../src/modules/cart/routes';
import { localDate, parseWindow } from '../../src/modules/merchant/analytics/params';
import { itemTotals } from '../../src/modules/merchant/analytics/queries';
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

// CRM phase 3, slice 3b: the in-store cart (spec §6.1, plan P1–P3, P6).

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

async function setup() {
  const m = await createTestMerchant(app);
  const b1 = await createTestBranch(app, m.merchantId);
  const b2 = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, b1.id);
  const staff1 = await createTestStaff(app, m.merchantId, b1.id);
  const staff2 = await createTestStaff(app, m.merchantId, b2.id);
  const gt = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, gt.id);
  const owner = await memberAuthHeader(app, m.userId);
  const variant = async (size: string, priceOverridePaise?: number) =>
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/catalog/${item.id}/variants`,
        headers: owner,
        payload: {
          size,
          barcode: `89${randomUUID().replace(/\D/g, '').slice(0, 11)}`,
          priceOverridePaise,
        },
      })
    ).json() as { id: string; barcode: string };
  return { m, b1, b2, device, staff1, staff2, item, owner, variant };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const start = async (ctx: Ctx, mode: 'kiosk' | 'assisted') =>
  (
    await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: {
        ...ctx.device.auth,
        ...(mode === 'assisted' ? { 'x-staff-authorization': ctx.staff1.auth.authorization } : {}),
      },
      payload: { mode },
    })
  ).json().id as string;
const add = (ctx: Ctx, sid: string, variantId: string, quantity = 1, key?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/device/sessions/${sid}/cart/lines`,
    headers: { ...ctx.device.auth, ...(key ? { 'idempotency-key': key } : {}) },
    payload: { variantId, quantity },
  });
const soldRows = (sid: string) =>
  app.db
    .select()
    .from(schema.sessionItems)
    .where(and(eq(schema.sessionItems.sessionId, sid), eq(schema.sessionItems.action, 'sold')));

describe('cart on the tablet', () => {
  it('a kiosk shopper adds sizes; the same size again raises the quantity; barcodes and a code come back', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M', 49_900);
    const sid = await start(ctx, 'kiosk');
    expect((await add(ctx, sid, m.id)).statusCode).toBe(201);
    const res = await add(ctx, sid, m.id, 2);
    const cart = res.json();
    expect(cart.cartCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      size: 'M',
      barcode: m.barcode,
      quantity: 3,
      unitPricePaise: 49_900,
      addedBy: 'shopper',
      billed: false,
    });
    expect(cart.totalPaise).toBe(3 * 49_900);
  });

  it('a retried add with the same Idempotency-Key adds once', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    const sid = await start(ctx, 'kiosk');
    const key = randomUUID();
    await add(ctx, sid, m.id, 1, key);
    const again = await add(ctx, sid, m.id, 1, key);
    expect(again.json().lines[0].quantity).toBe(1);
  });

  it('an out-of-stock size at this branch cannot be added', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    await app.inject({
      method: 'PUT',
      url: `/v1/merchant/variants/${m.id}/stock/${ctx.b1.id}`,
      headers: ctx.owner,
      payload: { status: 'out' },
    });
    const sid = await start(ctx, 'kiosk');
    const res = await add(ctx, sid, m.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OUT_OF_STOCK');
  });

  it("another merchant's variant is a 404", async () => {
    const ctx = await setup();
    const other = await setup();
    const v = await other.variant('M');
    const sid = await start(ctx, 'kiosk');
    expect((await add(ctx, sid, v.id)).statusCode).toBe(404);
  });

  it('removing a line writes cart_removed once', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    const sid = await start(ctx, 'kiosk');
    const lineId = (await add(ctx, sid, m.id)).json().lines[0].id;
    const del = () =>
      app.inject({
        method: 'DELETE',
        url: `/v1/device/sessions/${sid}/cart/lines/${lineId}`,
        headers: ctx.device.auth,
      });
    expect((await del()).json().lines).toEqual([]);
    await del();
    const events = await app.db
      .select({ event: schema.analyticsEvents.event })
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.sessionId, sid));
    expect(events.map((e) => e.event).filter((e) => e.startsWith('cart_'))).toEqual([
      'cart_added',
      'cart_removed',
    ]);
  });
});

describe('billing', () => {
  it('assisted: the signed-in staff member bills on the tablet; one sold row + sale_recorded per unit', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M', 10_000);
    const sid = await start(ctx, 'assisted');
    await add(ctx, sid, m.id, 2);
    const noStaff = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${sid}/cart/bill`,
      headers: ctx.device.auth,
      payload: {},
    });
    expect(noStaff.statusCode).toBe(401);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${sid}/cart/bill`,
      headers: { ...ctx.device.auth, 'x-staff-authorization': ctx.staff1.auth.authorization },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'billed',
      lines: [{ billed: true, unitPricePaise: 10_000 }],
    });
    const sold = await soldRows(sid);
    expect(sold).toHaveLength(2);
    expect(sold.every((r) => r.staffId === ctx.staff1.staffId)).toBe(true);
    const sales = await app.db
      .select()
      .from(schema.analyticsEvents)
      .where(
        and(
          eq(schema.analyticsEvents.sessionId, sid),
          eq(schema.analyticsEvents.event, 'sale_recorded'),
        ),
      );
    expect(sales).toHaveLength(2);
    expect(sales[0]!.props).toMatchObject({ source: 'staff', pricePaise: 10_000 });
  });

  it('kiosk: billed at the counter by code after the session ended; staff of another branch cannot see it', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    const sid = await start(ctx, 'kiosk');
    const code = (await add(ctx, sid, m.id)).json().cartCode as string;
    await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${sid}/end`,
      headers: ctx.device.auth,
    });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchant/carts/${code}`,
          headers: ctx.staff2.auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/merchant/carts/${code.toLowerCase()}`,
          headers: ctx.staff1.auth,
        })
      ).statusCode,
    ).toBe(200);
    const bill = () =>
      app.inject({
        method: 'POST',
        url: `/v1/merchant/carts/${code}/bill`,
        headers: ctx.staff1.auth,
        payload: {},
      });
    expect((await bill()).json().status).toBe('billed');
    // A retried bill never double-counts.
    await bill();
    expect(await soldRows(sid)).toHaveLength(1);
    const [audit] = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'cart.bill'));
    expect(audit).toBeDefined();
  });

  it('billed lines count as sold on the merchant dashboard (plan P2 parity)', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    const sid = await start(ctx, 'kiosk');
    const code = (await add(ctx, sid, m.id, 3)).json().cartCode as string;
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/carts/${code}/bill`,
      headers: ctx.owner,
      payload: {},
    });
    const now = new Date();
    const w = parseWindow(
      {
        from: localDate(new Date(now.getTime() - 86_400_000), 'Asia/Kolkata'),
        to: localDate(now, 'Asia/Kolkata'),
      },
      now,
    );
    const totals = await itemTotals(
      app.db,
      { merchantId: ctx.m.merchantId, isStaff: false, memberStaffId: null },
      w,
    );
    expect(totals.sold).toBe(3);
  });

  it('carts open for more than a day become abandoned and can no longer be billed', async () => {
    const ctx = await setup();
    const m = await ctx.variant('M');
    const sid = await start(ctx, 'kiosk');
    const code = (await add(ctx, sid, m.id)).json().cartCode as string;
    await app.db
      .update(schema.carts)
      .set({ createdAt: sql`now() - interval '25 hours'` as unknown as Date })
      .where(eq(schema.carts.cartCode, code));
    expect(await runCartAbandonTick(app)).toBeGreaterThanOrEqual(1);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/carts/${code}/bill`,
      headers: ctx.owner,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(await soldRows(sid)).toHaveLength(0);
  });
});
