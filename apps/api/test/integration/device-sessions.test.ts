import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInstoreSessionSweepTick } from '../../src/modules/device/session-sweeper';
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
  return { m, branch, device, staff, item };
}
const startSession = (
  device: { auth: Record<string, string> },
  payload: object,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/sessions',
    headers: { ...device.auth, ...extra },
    payload,
  });

describe('device sessions', () => {
  it('starts a kiosk session without staff', async () => {
    const { device, branch, m } = await setup();
    const res = await startSession(device, { mode: 'kiosk' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mode: 'kiosk', branchId: branch.id, staffId: null });
    const [row] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(eq(schema.instoreSessions.id, res.json().id));
    expect(row).toMatchObject({ merchantId: m.merchantId, deviceId: device.deviceId });
  });

  it("assisted needs a staff JWT of this device's branch", async () => {
    const { m, device, staff } = await setup();
    const none = await startSession(device, { mode: 'assisted' });
    expect(none.statusCode).toBe(401);

    const ok = await startSession(
      device,
      { mode: 'assisted' },
      { 'x-staff-authorization': staff.auth.authorization },
    );
    expect(ok.statusCode).toBe(201);
    expect(ok.json().staffId).toBe(staff.staffId);

    const otherBranch = await createTestBranch(app, m.merchantId);
    const elsewhere = await createTestStaff(app, m.merchantId, otherBranch.id);
    const wrongBranch = await startSession(
      device,
      { mode: 'assisted' },
      { 'x-staff-authorization': elsewhere.auth.authorization },
    );
    expect(wrongBranch.statusCode).toBe(403);

    const otherMerchant = await createTestMerchant(app);
    const ob = await createTestBranch(app, otherMerchant.merchantId);
    const foreignStaff = await createTestStaff(app, otherMerchant.merchantId, ob.id);
    const wrongMerchant = await startSession(
      device,
      { mode: 'assisted' },
      { 'x-staff-authorization': foreignStaff.auth.authorization },
    );
    expect(wrongMerchant.statusCode).toBe(403);

    const owner = await memberAuthHeader(app, m.userId);
    const asAdmin = await startSession(
      device,
      { mode: 'assisted' },
      { 'x-staff-authorization': owner.authorization },
    );
    expect(asAdmin.statusCode).toBe(403);

    await app.db
      .update(schema.merchantStaff)
      .set({ isActive: false })
      .where(eq(schema.merchantStaff.id, staff.staffId));
    const inactive = await startSession(
      device,
      { mode: 'assisted' },
      { 'x-staff-authorization': staff.auth.authorization },
    );
    expect(inactive.statusCode).toBe(403);
  });

  it('is idempotent on Idempotency-Key', async () => {
    const { device } = await setup();
    const key = randomUUID();
    const a = await startSession(device, { mode: 'kiosk' }, { 'idempotency-key': key });
    const b = await startSession(device, { mode: 'kiosk' }, { 'idempotency-key': key });
    expect(a.json().id).toBe(b.json().id);
  });

  it('ends a session once and refuses items on an ended session', async () => {
    const { device, item: ownItem } = await setup();
    const s = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const end = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/end`,
      headers: device.auth,
    });
    expect(end.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/end`,
      headers: device.auth,
    });
    expect(again.statusCode).toBe(200);
    const item = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/items`,
      headers: device.auth,
      payload: { catalogItemId: ownItem.id, action: 'wishlisted' },
    });
    expect(item.statusCode).toBe(409);
    expect(item.json().error.code).toBe('SESSION_ENDED');
  });

  it("a device cannot see or change another device's session", async () => {
    const a = await setup();
    const other = await setup();
    const s = (await startSession(a.device, { mode: 'kiosk' })).json() as { id: string };
    const end = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/end`,
      headers: other.device.auth,
    });
    expect(end.statusCode).toBe(404);
    const item = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${s.id}/items`,
      headers: other.device.auth,
      payload: { catalogItemId: other.item.id, action: 'wishlisted' },
    });
    expect(item.statusCode).toBe(404);
  });
});

describe('session items and sales', () => {
  it('records wishlist in kiosk mode but only allows sold in an assisted session', async () => {
    const { device, staff, item } = await setup();
    const kiosk = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const wish = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${kiosk.id}/items`,
      headers: device.auth,
      payload: { catalogItemId: item.id, action: 'wishlisted' },
    });
    expect(wish.statusCode).toBe(201);
    const soldKiosk = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${kiosk.id}/items`,
      headers: device.auth,
      payload: { catalogItemId: item.id, action: 'sold' },
    });
    expect(soldKiosk.statusCode).toBe(409);
    expect(soldKiosk.json().error.code).toBe('SOLD_REQUIRES_ASSISTED');

    const assisted = (
      await startSession(
        device,
        { mode: 'assisted' },
        { 'x-staff-authorization': staff.auth.authorization },
      )
    ).json() as { id: string };
    const sold = await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${assisted.id}/items`,
      headers: device.auth,
      payload: { catalogItemId: item.id, action: 'sold' },
    });
    expect(sold.statusCode).toBe(201);
    expect(sold.json()).toMatchObject({ action: 'sold', staffId: staff.staffId, voidedAt: null });
  });

  it('rejects a catalog item that is not the merchant own', async () => {
    const { device, item } = await setup();
    const stranger = await setup();
    const kiosk = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const post = (catalogItemId: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/device/sessions/${kiosk.id}/items`,
        headers: device.auth,
        payload: { catalogItemId, action: 'wishlisted' },
      });
    const missing = await post(randomUUID());
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe('catalog item not found');
    expect((await post(stranger.item.id)).statusCode).toBe(404);
    expect((await post(item.id)).statusCode).toBe(201);
    const rows = await app.db
      .select()
      .from(schema.sessionItems)
      .where(eq(schema.sessionItems.sessionId, kiosk.id));
    expect(rows).toHaveLength(1);
  });

  async function soldItem() {
    const ctx = await setup();
    const assisted = (
      await startSession(
        ctx.device,
        { mode: 'assisted' },
        { 'x-staff-authorization': ctx.staff.auth.authorization },
      )
    ).json() as { id: string };
    const sold = (
      await app.inject({
        method: 'POST',
        url: `/v1/device/sessions/${assisted.id}/items`,
        headers: ctx.device.auth,
        payload: { catalogItemId: ctx.item.id, action: 'sold' },
      })
    ).json() as { id: string };
    return { ...ctx, sessionId: assisted.id, itemId: sold.id };
  }
  const undo = (
    ctx: { sessionId: string; itemId: string; device: { auth: Record<string, string> } },
    staffAuth?: Record<string, string>,
  ) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/device/sessions/${ctx.sessionId}/items/${ctx.itemId}`,
      headers: {
        ...ctx.device.auth,
        ...(staffAuth ? { 'x-staff-authorization': staffAuth.authorization } : {}),
      },
    });

  it('the selling staff member can undo within 24h; the row is voided, not deleted', async () => {
    const ctx = await soldItem();
    const res = await undo(ctx, ctx.staff.auth);
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.sessionItems)
      .where(eq(schema.sessionItems.id, ctx.itemId));
    expect(row!.voidedAt).toBeInstanceOf(Date);
    expect(row!.voidedBy).toBe(ctx.staff.userId);
    const again = await undo(ctx, ctx.staff.auth);
    expect(again.statusCode).toBe(409);
  });

  it('refuses undo by another staff member, without staff auth, and after 24h', async () => {
    const ctx = await soldItem();
    const colleague = await createTestStaff(app, ctx.m.merchantId, ctx.branch.id);
    expect((await undo(ctx, colleague.auth)).statusCode).toBe(403);
    expect((await undo(ctx)).statusCode).toBe(401);

    await app.db
      .update(schema.sessionItems)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(schema.sessionItems.id, ctx.itemId));
    const late = await undo(ctx, ctx.staff.auth);
    expect(late.statusCode).toBe(403);
    expect(late.json().error.code).toBe('UNDO_WINDOW_PASSED');
  });

  it('the merchant admin can void any time; other merchants and staff cannot', async () => {
    const ctx = await soldItem();
    await app.db
      .update(schema.sessionItems)
      .set({ createdAt: sql`now() - interval '40 days'` })
      .where(eq(schema.sessionItems.id, ctx.itemId));
    const url = `/v1/merchant/org/session-items/${ctx.itemId}/void`;

    const stranger = await createTestMerchant(app);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: await memberAuthHeader(app, stranger.userId),
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url, headers: ctx.staff.auth })).statusCode).toBe(
      403,
    );

    const ok = await app.inject({
      method: 'POST',
      url,
      headers: await memberAuthHeader(app, ctx.m.userId),
    });
    expect(ok.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.sessionItems)
      .where(eq(schema.sessionItems.id, ctx.itemId));
    expect(row!.voidedBy).toBe(ctx.m.userId);
  });

  it('audits start, end, sale and void', async () => {
    const ctx = await soldItem();
    await undo(ctx, ctx.staff.auth);
    await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${ctx.sessionId}/end`,
      headers: ctx.device.auth,
    });
    const logs = await app.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.actorRole, 'DEVICE'),
          inArray(schema.auditLogs.resourceId, [ctx.sessionId, ctx.itemId]),
        ),
      );
    const has = (action: string, resourceId: string) =>
      logs.some((a) => a.action === action && a.resourceId === resourceId);
    expect(has('instore_session.start', ctx.sessionId)).toBe(true);
    expect(has('instore_session.end', ctx.sessionId)).toBe(true);
    expect(has('session_item.sold', ctx.itemId)).toBe(true);
    expect(has('session_item.void', ctx.itemId)).toBe(true);
  });
});

describe('idle session sweeper', () => {
  it('ends only sessions idle past the window', async () => {
    const { device } = await setup();
    const idle = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const active = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    await app.db
      .update(schema.instoreSessions)
      .set({ lastActivityAt: sql`now() - interval '11 minutes'` })
      .where(eq(schema.instoreSessions.id, idle.id));

    const { ended } = await runInstoreSessionSweepTick(app, { idleMs: 10 * 60_000 });
    expect(ended).toBeGreaterThanOrEqual(1);
    const rows = await app.db.select().from(schema.instoreSessions);
    expect(rows.find((r) => r.id === idle.id)!.endedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === active.id)!.endedAt).toBeNull();
  });
});
