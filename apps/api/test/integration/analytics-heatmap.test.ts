import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvents } from '../../src/modules/analytics/record';
import { runAnalyticsRollupTick } from '../../src/modules/analytics/rollup';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// Analytics phase 1, plan Task 6: GET /v1/merchant/analytics/heatmap.

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

interface Cell {
  weekday: number;
  hour: number;
  value: number;
}

async function setup() {
  const m = await createTestMerchant(app);
  const b1 = await createTestBranch(app, m.merchantId);
  const b2 = await createTestBranch(app, m.merchantId);
  const d1 = await createTestDevice(app, m.merchantId, b1.id);
  const d2 = await createTestDevice(app, m.merchantId, b2.id);
  const staff1 = await createTestStaff(app, m.merchantId, b1.id);
  return { m, b1, b2, d1, d2, staff1, admin: await memberAuthHeader(app, m.userId) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const event = (
  ctx: Ctx,
  name: 'session_started' | 'tryon_requested',
  iso: string,
  where: 'b1' | 'b2' = 'b1',
) => ({
  event: name,
  merchantId: ctx.m.merchantId,
  branchId: where === 'b1' ? ctx.b1.id : ctx.b2.id,
  deviceId: where === 'b1' ? ctx.d1.deviceId : ctx.d2.deviceId,
  channel: 'kiosk',
  occurredAt: new Date(iso),
});

const get = (auth: Record<string, string>, qs: string) =>
  app.inject({ method: 'GET', url: `/v1/merchant/analytics/heatmap?${qs}`, headers: auth });
const nonZero = (cells: Cell[]) => cells.filter((x) => x.value !== 0);

// 2026-11-01 is a Sunday. 04:30Z = 10:00 IST Sunday; 19:00Z Sunday = 00:30 IST Monday.
const WINDOW = 'from=2026-11-01&to=2026-11-07';

describe('GET /v1/merchant/analytics/heatmap', () => {
  it('buckets by local weekday and hour in IST, zero-filled to 168 cells', async () => {
    const ctx = await setup();
    await recordEvents(app.db, [
      event(ctx, 'session_started', '2026-11-01T04:30:00Z'),
      event(ctx, 'session_started', '2026-11-01T05:29:59Z'),
      event(ctx, 'session_started', '2026-11-01T19:00:00Z'),
      event(ctx, 'tryon_requested', '2026-11-01T04:40:00Z'),
      // 23:59 IST 31 Oct and 00:00 IST 08 Nov: just outside the window on either side.
      event(ctx, 'session_started', '2026-10-31T18:29:00Z'),
      event(ctx, 'session_started', '2026-11-07T18:30:00Z'),
    ]);
    await runAnalyticsRollupTick(app, { lagSeconds: 0 });

    const res = await get(ctx.admin, WINDOW);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { metric: string; cells: Cell[]; window: { tz: string } };
    expect(body.metric).toBe('sessions');
    expect(body.window.tz).toBe('Asia/Kolkata');
    expect(body.cells).toHaveLength(168);
    expect(body.cells[0]).toEqual({ weekday: 0, hour: 0, value: 0 });
    expect(body.cells[167]).toEqual({ weekday: 6, hour: 23, value: 0 });
    // 04:30Z and 05:29:59Z are both 10:xx IST.
    expect(nonZero(body.cells)).toEqual([
      { weekday: 0, hour: 10, value: 2 },
      { weekday: 1, hour: 0, value: 1 },
    ]);

    const tryons = (await get(ctx.admin, `${WINDOW}&metric=tryons`)).json() as { cells: Cell[] };
    expect(nonZero(tryons.cells)).toEqual([{ weekday: 0, hour: 10, value: 1 }]);
  });

  it('staff see only their own branch; naming another branch is a 403', async () => {
    const ctx = await setup();
    await recordEvents(app.db, [
      event(ctx, 'session_started', '2026-11-02T06:00:00Z', 'b1'),
      event(ctx, 'session_started', '2026-11-02T06:00:00Z', 'b2'),
      event(ctx, 'session_started', '2026-11-02T06:10:00Z', 'b2'),
    ]);
    await runAnalyticsRollupTick(app, { lagSeconds: 0 });

    const sum = (cells: Cell[]) => cells.reduce((a, x) => a + x.value, 0);
    expect(sum((await get(ctx.admin, WINDOW)).json().cells)).toBe(3);
    expect(sum((await get(ctx.admin, `${WINDOW}&branchId=${ctx.b2.id}`)).json().cells)).toBe(2);
    expect(sum((await get(ctx.staff1.auth, WINDOW)).json().cells)).toBe(1);
    expect((await get(ctx.staff1.auth, `${WINDOW}&branchId=${ctx.b2.id}`)).statusCode).toBe(403);
  });

  it("another merchant's branch id returns zeros for an admin, not a 404", async () => {
    const ctx = await setup();
    const other = await setup();
    await recordEvents(app.db, [event(other, 'session_started', '2026-11-03T06:00:00Z')]);
    await runAnalyticsRollupTick(app, { lagSeconds: 0 });
    const res = await get(ctx.admin, `${WINDOW}&branchId=${other.b1.id}`);
    expect(res.statusCode).toBe(200);
    expect(nonZero(res.json().cells)).toEqual([]);
  });

  it('rejects an unknown metric and an unauthenticated caller', async () => {
    const ctx = await setup();
    expect((await get(ctx.admin, `${WINDOW}&metric=revenue`)).statusCode).toBe(400);
    expect((await get({}, WINDOW)).statusCode).toBe(401);
  });
});
