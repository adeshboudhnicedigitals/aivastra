import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
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
} from '../helpers/merchant';

// Analytics phase 1, plan Task 4: POST /v1/device/events.

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
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const staff = await createTestStaff(app, m.merchantId, branch.id);
  const garmentType = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
  return { m, branch, device, staff, garmentType, item };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const ev = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  event: 'item_viewed',
  occurredAt: new Date().toISOString(),
  ...over,
});
const post = (device: { auth: Record<string, string> }, events: unknown[], ip?: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/events',
    headers: device.auth,
    payload: { events },
    ...(ip ? { remoteAddress: ip } : {}),
  });
const storedFor = (deviceId: string) =>
  app.db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.deviceId, deviceId));
const startSession = async (ctx: Ctx, mode: 'kiosk' | 'assisted') =>
  (
    await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: {
        ...ctx.device.auth,
        ...(mode === 'assisted' ? { 'x-staff-authorization': ctx.staff.auth.authorization } : {}),
      },
      payload: { mode },
    })
  ).json() as { id: string };

describe('POST /v1/device/events', () => {
  it('stores client events with dimensions from the device token, ignoring body dimensions', async () => {
    const ctx = await setup();
    const other = await createTestMerchant(app);
    const e = ev({
      catalogItemId: ctx.item.id,
      props: { category: 'kurta' },
      merchantId: other.merchantId,
      branchId: randomUUID(),
      deviceId: randomUUID(),
    });
    const res = await post(ctx.device, [e]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, duplicates: 0, dropped: 0, rejected: 0 });
    const [row] = await storedFor(ctx.device.deviceId);
    expect(row).toMatchObject({
      clientEventId: e.id,
      event: 'item_viewed',
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      sessionId: null,
      staffId: null,
      channel: null,
      catalogItemId: ctx.item.id,
      props: { category: 'kurta' },
    });
  });

  it("an in-session event takes the session's branch, staff and channel, even after a device move", async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const elsewhere = await createTestBranch(app, ctx.m.merchantId);
    await app.db
      .update(schema.merchantDevices)
      .set({ branchId: elsewhere.id })
      .where(eq(schema.merchantDevices.id, ctx.device.deviceId));
    expect((await post(ctx.device, [ev({ sessionId: s.id })])).json().accepted).toBe(1);
    const [row] = (await storedFor(ctx.device.deviceId)).filter((r) => r.event === 'item_viewed');
    expect(row).toMatchObject({
      sessionId: s.id,
      branchId: ctx.branch.id,
      staffId: ctx.staff.staffId,
      channel: 'assisted',
    });
  });

  it('rejects server and derived event names with 400 and stores nothing', async () => {
    const ctx = await setup();
    for (const name of ['session_started', 'sale_recorded', 'tryon_completed']) {
      const res = await post(ctx.device, [ev(), ev({ event: name })]);
      expect(res.statusCode, name).toBe(400);
    }
    expect(await storedFor(ctx.device.deviceId)).toHaveLength(0);
  });

  it("rejects per event: another device's session and another merchant's item; the rest are stored", async () => {
    const ctx = await setup();
    const sibling = await createTestDevice(app, ctx.m.merchantId, ctx.branch.id);
    const siblingSession = (
      await app.inject({
        method: 'POST',
        url: '/v1/device/sessions',
        headers: sibling.auth,
        payload: { mode: 'kiosk' },
      })
    ).json() as { id: string };
    const stranger = await setup();

    const res = await post(ctx.device, [
      ev({ sessionId: siblingSession.id }),
      ev({ sessionId: randomUUID() }),
      ev({ catalogItemId: stranger.item.id }),
      ev({ catalogItemId: ctx.item.id }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, duplicates: 0, dropped: 0, rejected: 3 });
    const rows = await storedFor(ctx.device.deviceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.catalogItemId).toBe(ctx.item.id);
  });

  it('accepts an own item that was soft-deleted after it was viewed', async () => {
    const ctx = await setup();
    await app.db
      .update(schema.merchantCatalogItems)
      .set({ deletedAt: new Date() })
      .where(eq(schema.merchantCatalogItems.id, ctx.item.id));
    expect((await post(ctx.device, [ev({ catalogItemId: ctx.item.id })])).json()).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
  });

  it('a replayed batch is all duplicates and stores nothing new', async () => {
    const ctx = await setup();
    const batch = [ev(), ev({ event: 'qr_scanned' }), ev({ event: 'buy_online_click' })];
    expect((await post(ctx.device, batch)).json()).toMatchObject({ accepted: 3, duplicates: 0 });
    expect((await post(ctx.device, batch)).json()).toMatchObject({ accepted: 0, duplicates: 3 });
    // The same id twice inside one batch is one row too.
    const dup = ev();
    expect((await post(ctx.device, [dup, dup])).json()).toMatchObject({
      accepted: 1,
      duplicates: 1,
    });
    expect(await storedFor(ctx.device.deviceId)).toHaveLength(4);
  });

  it('dedupes per device: two devices may use the same client id', async () => {
    const ctx = await setup();
    const sibling = await createTestDevice(app, ctx.m.merchantId, ctx.branch.id);
    const id = randomUUID();
    expect((await post(ctx.device, [ev({ id })])).json().accepted).toBe(1);
    expect((await post(sibling, [ev({ id })])).json().accepted).toBe(1);
  });

  it('clamps a future timestamp to now and flags it; drops events older than 7 days', async () => {
    const ctx = await setup();
    const before = Date.now();
    const res = await post(ctx.device, [
      ev({ event: 'qr_shown', occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
      ev({ event: 'qr_scanned', occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }),
      ev({ event: 'item_viewed', occurredAt: new Date(Date.now() - 6 * 86_400_000).toISOString() }),
    ]);
    expect(res.json()).toEqual({ accepted: 2, duplicates: 0, dropped: 1, rejected: 0 });
    const rows = await storedFor(ctx.device.deviceId);
    const skewed = rows.find((r) => r.event === 'qr_shown')!;
    expect(skewed.props).toMatchObject({ clockSkew: true });
    expect(skewed.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(skewed.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(rows.find((r) => r.event === 'item_viewed')!.props).not.toHaveProperty('clockSkew');
  });

  it('refuses an unpaired or deactivated device with 401', async () => {
    const ctx = await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/device/events',
          payload: { events: [ev()] },
        })
      ).statusCode,
    ).toBe(401);
    await app.db
      .update(schema.merchantDevices)
      .set({ isActive: false })
      .where(eq(schema.merchantDevices.id, ctx.device.deviceId));
    expect((await post(ctx.device, [ev()])).statusCode).toBe(401);
    expect(await storedFor(ctx.device.deviceId)).toHaveLength(0);
  });

  it('rate-limits per device, not per store IP', async () => {
    const ctx = await setup();
    const sibling = await createTestDevice(app, ctx.m.merchantId, ctx.branch.id);
    // RFC 5737 test address: both tablets sit behind one store NAT.
    const storeIp = '203.0.113.77';
    for (let i = 0; i < 60; i++)
      expect((await post(ctx.device, [ev()], storeIp)).statusCode).toBe(200);
    expect((await post(ctx.device, [ev()], storeIp)).statusCode).toBe(429);
    expect((await post(sibling, [ev()], storeIp)).statusCode).toBe(200);
  });
});
