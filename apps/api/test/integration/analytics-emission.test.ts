import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInstoreSessionSweepTick } from '../../src/modules/device/session-sweeper';
import { createGarmentTryonJob } from '../../src/modules/merchant/tryon-job-service';
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

// Analytics phase 1, plan Task 3: every in-store fact the API writes gets exactly one
// analytics event, in the same transaction, with the session's dimensions.

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

async function setup(balance = 100) {
  const m = await createTestMerchant(app, { balance });
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const staff = await createTestStaff(app, m.merchantId, branch.id);
  const garmentType = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
  return { m, branch, device, staff, item };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const startSession = async (ctx: Ctx, mode: 'kiosk' | 'assisted', key?: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/device/sessions',
    headers: {
      ...ctx.device.auth,
      ...(mode === 'assisted' ? { 'x-staff-authorization': ctx.staff.auth.authorization } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload: { mode },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
};
const addItem = async (ctx: Ctx, sessionId: string, action: 'wishlisted' | 'sold') => {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/device/sessions/${sessionId}/items`,
    headers: ctx.device.auth,
    payload: { catalogItemId: ctx.item.id, action },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
};
const eventsOf = (sessionId: string) =>
  app.db
    .select()
    .from(schema.analyticsEvents)
    .where(eq(schema.analyticsEvents.sessionId, sessionId))
    .orderBy(schema.analyticsEvents.occurredAt);
const names = async (sessionId: string) => (await eventsOf(sessionId)).map((e) => e.event);

describe('session events', () => {
  it('session start writes session_started with the session dimensions', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'kiosk');
    const [e, ...rest] = await eventsOf(s.id);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      event: 'session_started',
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      staffId: null,
      channel: 'kiosk',
      clientEventId: null,
    });
  });

  it('an assisted session carries the staff member', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const [e] = await eventsOf(s.id);
    expect(e).toMatchObject({ channel: 'assisted', staffId: ctx.staff.staffId });
  });

  it('an idempotent replay of session start writes no second event', async () => {
    const ctx = await setup();
    const key = randomUUID();
    const a = await startSession(ctx, 'kiosk', key);
    const b = await startSession(ctx, 'kiosk', key);
    expect(b.id).toBe(a.id);
    expect(await names(a.id)).toEqual(['session_started']);
  });

  it('ending writes session_ended once with reason done; ending again writes nothing', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'kiosk');
    const end = () =>
      app.inject({
        method: 'POST',
        url: `/v1/device/sessions/${s.id}/end`,
        headers: ctx.device.auth,
      });
    expect((await end()).statusCode).toBe(200);
    expect((await end()).statusCode).toBe(200);
    const ended = (await eventsOf(s.id)).filter((e) => e.event === 'session_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.props).toEqual({ reason: 'done' });
  });

  it('the idle sweeper writes session_ended with reason idle, only for sessions it ends', async () => {
    const ctx = await setup();
    const idle = await startSession(ctx, 'kiosk');
    const active = await startSession(ctx, 'kiosk');
    await app.db
      .update(schema.instoreSessions)
      .set({ lastActivityAt: sql`now() - interval '11 minutes'` })
      .where(eq(schema.instoreSessions.id, idle.id));

    await runInstoreSessionSweepTick(app, { idleMs: 10 * 60_000 });
    const [ended] = (await eventsOf(idle.id)).filter((e) => e.event === 'session_ended');
    expect(ended).toMatchObject({ props: { reason: 'idle' }, deviceId: ctx.device.deviceId });
    expect(await names(active.id)).toEqual(['session_started']);

    // A second sweep finds nothing new to end and writes nothing.
    await runInstoreSessionSweepTick(app, { idleMs: 10 * 60_000 });
    expect((await eventsOf(idle.id)).filter((e) => e.event === 'session_ended')).toHaveLength(1);
  });
});

describe('item and sale events', () => {
  it('a wishlist in an assisted session is attributed to the assisting staff (ITEM_STAFF)', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const item = await addItem(ctx, s.id, 'wishlisted');
    const [e] = (await eventsOf(s.id)).filter((x) => x.event === 'item_wishlisted');
    expect(e).toMatchObject({
      staffId: ctx.staff.staffId,
      catalogItemId: ctx.item.id,
      props: { sessionItemId: item.id },
    });
  });

  it('a kiosk wishlist has no staff', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'kiosk');
    await addItem(ctx, s.id, 'wishlisted');
    const [e] = (await eventsOf(s.id)).filter((x) => x.event === 'item_wishlisted');
    expect(e!.staffId).toBeNull();
  });

  it('a sale writes sale_recorded; the seller undoing it writes sale_voided for the seller', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const sold = await addItem(ctx, s.id, 'sold');
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/device/sessions/${s.id}/items/${sold.id}`,
      headers: { ...ctx.device.auth, 'x-staff-authorization': ctx.staff.auth.authorization },
    });
    expect(res.statusCode).toBe(200);
    const evs = await eventsOf(s.id);
    expect(evs.map((e) => e.event)).toEqual(['session_started', 'sale_recorded', 'sale_voided']);
    const voided = evs[2]!;
    expect(voided).toMatchObject({
      staffId: ctx.staff.staffId,
      catalogItemId: ctx.item.id,
      props: { sessionItemId: sold.id, voidedBy: ctx.staff.userId },
    });
  });

  it('a refused undo writes nothing', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const sold = await addItem(ctx, s.id, 'sold');
    const colleague = await createTestStaff(app, ctx.m.merchantId, ctx.branch.id);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/device/sessions/${s.id}/items/${sold.id}`,
      headers: { ...ctx.device.auth, 'x-staff-authorization': colleague.auth.authorization },
    });
    expect(res.statusCode).toBe(403);
    expect(await names(s.id)).toEqual(['session_started', 'sale_recorded']);
  });

  it('the merchant admin void writes sale_voided, still attributed to the seller', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'assisted');
    const sold = await addItem(ctx, s.id, 'sold');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/session-items/${sold.id}/void`,
      headers: await memberAuthHeader(app, ctx.m.userId),
    });
    expect(res.statusCode).toBe(200);
    const [voided] = (await eventsOf(s.id)).filter((e) => e.event === 'sale_voided');
    expect(voided).toMatchObject({
      staffId: ctx.staff.staffId,
      props: { sessionItemId: sold.id, voidedBy: ctx.m.userId },
    });
  });

  it('a rejected sale (kiosk session) writes nothing', async () => {
    const ctx = await setup();
    const s = await startSession(ctx, 'kiosk');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/items`,
      headers: ctx.device.auth,
      payload: { catalogItemId: ctx.item.id, action: 'sold' },
    });
    expect(res.statusCode).toBe(409);
    expect(await names(s.id)).toEqual(['session_started']);
  });
});

describe('try-on events', () => {
  it('a device try-on writes tryon_requested with the job id, beside the charge', async () => {
    const ctx = await setup(100);
    const s = await startSession(ctx, 'assisted');
    const photo = await stageCustomerPhoto(app, ctx.m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: ctx.device.auth,
      payload: { sessionId: s.id, merchantCatalogItemId: ctx.item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };
    const [e, ...rest] = (await eventsOf(s.id)).filter((x) => x.event === 'tryon_requested');
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      staffId: ctx.staff.staffId,
      catalogItemId: ctx.item.id,
      channel: 'assisted',
      props: { jobId },
    });
  });

  it('a try-on refused for credits leaves no event (same transaction as the charge)', async () => {
    const ctx = await setup(0);
    const s = await startSession(ctx, 'kiosk');
    const photo = await stageCustomerPhoto(app, ctx.m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: ctx.device.auth,
      payload: { sessionId: s.id, merchantCatalogItemId: ctx.item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await names(s.id)).toEqual(['session_started']);
  });

  it('a legacy (unattributed) merchant try-on writes no event', async () => {
    const ctx = await setup(100);
    const photo = await stageCustomerPhoto(app, ctx.m.merchantId);
    const { jobId } = await createGarmentTryonJob(app, ctx.m.merchantId, {
      merchantCatalogItemId: ctx.item.id,
      customerPhotoKey: photo,
    });
    const rows = await app.db
      .select({ id: schema.analyticsEvents.id })
      .from(schema.analyticsEvents)
      .where(sql`${schema.analyticsEvents.props}->>'jobId' = ${jobId}`);
    expect(rows).toHaveLength(0);
  });
});
