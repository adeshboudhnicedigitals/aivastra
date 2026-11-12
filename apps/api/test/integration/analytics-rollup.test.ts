import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, asc, eq } from 'drizzle-orm';
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
} from '../helpers/merchant';

// Analytics phase 1, plan Task 5: the rollup loop. lagSeconds: 0 so rows written a moment ago
// are inside the tick's window (production keeps a 60s commit-skew lag).

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

const tick = (trailingHours = 0) => runAnalyticsRollupTick(app, { lagSeconds: 0, trailingHours });

async function setup() {
  const m = await createTestMerchant(app);
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const staff = await createTestStaff(app, m.merchantId, branch.id);
  return { m, branch, device, staff };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const at = (iso: string) => new Date(iso);
const bucketsOf = (merchantId: string) =>
  app.db
    .select()
    .from(schema.analyticsBuckets)
    .where(eq(schema.analyticsBuckets.merchantId, merchantId))
    .orderBy(asc(schema.analyticsBuckets.bucketStart), asc(schema.analyticsBuckets.event));
const view = async (merchantId: string) =>
  (await bucketsOf(merchantId)).map((b) => ({
    at: b.bucketStart.toISOString(),
    event: b.event,
    count: b.count,
  }));

async function sessionRow(ctx: Ctx, mode: 'kiosk' | 'assisted') {
  const [s] = await app.db
    .insert(schema.instoreSessions)
    .values({
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      staffId: mode === 'assisted' ? ctx.staff.staffId : null,
      mode,
    })
    .returning();
  return s!;
}

async function job(
  ctx: Ctx,
  sessionId: string | null,
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  createdAt: string,
  completedAt: string,
) {
  const id = randomUUID();
  await app.db.insert(schema.jobs).values({
    id,
    userId: ctx.m.userId,
    merchantId: ctx.m.merchantId,
    status,
    creditsCharged: 5,
    source: 'merchant_tryon',
    sessionId,
    branchId: sessionId ? ctx.branch.id : null,
    deviceId: sessionId ? ctx.device.deviceId : null,
    createdAt: at(createdAt),
    completedAt: at(completedAt),
  });
  return id;
}

const kioskEvent = (ctx: Ctx, event: 'session_started' | 'item_viewed', iso: string) => ({
  event: event as 'session_started',
  merchantId: ctx.m.merchantId,
  branchId: ctx.branch.id,
  deviceId: ctx.device.deviceId,
  channel: 'kiosk',
  occurredAt: at(iso),
});

describe('analytics rollup', () => {
  it('buckets events into 15-minute UTC buckets that line up with IST quarter-hours', async () => {
    const ctx = await setup();
    // 04:30Z = 10:00 IST. 04:44:59 is the same bucket; 04:45 opens the next.
    await recordEvents(app.db, [
      kioskEvent(ctx, 'session_started', '2026-11-01T04:30:00Z'),
      kioskEvent(ctx, 'session_started', '2026-11-01T04:44:59Z'),
      kioskEvent(ctx, 'session_started', '2026-11-01T04:45:00Z'),
      kioskEvent(ctx, 'item_viewed', '2026-11-01T04:31:00Z'),
    ]);
    const r = await tick();
    expect(r.skipped).toBe(false);
    expect(await view(ctx.m.merchantId)).toEqual([
      { at: '2026-11-01T04:30:00.000Z', event: 'item_viewed', count: 1 },
      { at: '2026-11-01T04:30:00.000Z', event: 'session_started', count: 2 },
      { at: '2026-11-01T04:45:00.000Z', event: 'session_started', count: 1 },
    ]);
  });

  it('keys buckets by dimension: kiosk and assisted rows stay separate', async () => {
    const ctx = await setup();
    await recordEvents(app.db, [
      kioskEvent(ctx, 'session_started', '2026-11-02T05:00:00Z'),
      {
        ...kioskEvent(ctx, 'session_started', '2026-11-02T05:01:00Z'),
        channel: 'assisted',
        staffId: ctx.staff.staffId,
      },
    ]);
    await tick();
    const rows = await bucketsOf(ctx.m.merchantId);
    expect(rows).toHaveLength(2);
    expect(rows.find((b) => b.channel === 'assisted')).toMatchObject({
      staffId: ctx.staff.staffId,
      count: 1,
    });
    expect(rows.find((b) => b.channel === 'kiosk')).toMatchObject({ staffId: null, count: 1 });
  });

  it('a second tick with nothing new changes nothing (rebuild, never increment)', async () => {
    const ctx = await setup();
    await recordEvents(app.db, [kioskEvent(ctx, 'session_started', '2026-11-03T06:00:00Z')]);
    await tick();
    const before = await view(ctx.m.merchantId);
    const again = await tick();
    expect(again.rebuilt).toBe(0);
    await tick(48);
    expect(await view(ctx.m.merchantId)).toEqual(before);
  });

  it('a late offline event rebuilds only the bucket of its occurred_at', async () => {
    const ctx = await setup();
    await recordEvents(app.db, [
      kioskEvent(ctx, 'session_started', '2026-11-04T06:00:00Z'),
      kioskEvent(ctx, 'session_started', '2026-11-05T06:00:00Z'),
    ]);
    await tick();
    // Uploaded now, happened on the 4th: received_at is new, occurred_at is old.
    await recordEvents(app.db, [kioskEvent(ctx, 'session_started', '2026-11-04T06:05:00Z')]);
    const r = await tick();
    expect(r.rebuilt).toBe(1);
    expect(await view(ctx.m.merchantId)).toEqual([
      { at: '2026-11-04T06:00:00.000Z', event: 'session_started', count: 2 },
      { at: '2026-11-05T06:00:00.000Z', event: 'session_started', count: 1 },
    ]);
  });

  // Jobs are found by completed_at since the watermark, as the dispatcher stamps them at
  // settlement, so these use times just before now. Several near-now jobs can straddle a
  // bucket edge, hence the sums across rows.
  it('derives try-on outcomes and wait time from jobs; cancelled and session-less jobs are not outcomes', async () => {
    const ctx = await setup();
    const s = await sessionRow(ctx, 'assisted');
    // completed_at = now, as the dispatcher stamps it; only created_at is back-dated.
    const finishedNow = (
      status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
      waitMs: number,
      sid: string | null = s.id,
    ) => {
      const done = Date.now();
      return job(
        ctx,
        sid,
        status,
        new Date(done - waitMs).toISOString(),
        new Date(done).toISOString(),
      );
    };
    await finishedNow('COMPLETED', 30_000);
    await finishedNow('COMPLETED', 50_000);
    await finishedNow('FAILED', 10_000);
    await finishedNow('CANCELLED', 5_000);
    await finishedNow('COMPLETED', 20_000, null);
    await tick();
    const rows = await bucketsOf(ctx.m.merchantId);
    const sum = (event: string, k: 'count' | 'valueSum' | 'valueCount') =>
      rows.filter((b) => b.event === event).reduce((a, b) => a + b[k], 0);
    expect([...new Set(rows.map((b) => b.event))].sort()).toEqual([
      'tryon_completed',
      'tryon_failed',
    ]);
    expect(sum('tryon_completed', 'count')).toBe(2);
    expect(sum('tryon_completed', 'valueSum')).toBe(80_000);
    expect(sum('tryon_completed', 'valueCount')).toBe(2);
    expect(sum('tryon_failed', 'count')).toBe(1);
    expect(sum('tryon_failed', 'valueSum')).toBe(10_000);
    expect(rows.find((b) => b.event === 'tryon_completed')).toMatchObject({
      channel: 'assisted',
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
    });
  });

  it('a job stamped before the watermark (late commit, clock skew) is caught by the safety pass', async () => {
    const ctx = await setup();
    const s = await sessionRow(ctx, 'kiosk');
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await job(ctx, s.id, 'COMPLETED', old, old);
    await tick();
    expect(await bucketsOf(ctx.m.merchantId)).toHaveLength(0);
    await tick(48);
    expect((await bucketsOf(ctx.m.merchantId)).map((b) => b.event)).toEqual(['tryon_completed']);
  });

  it('a retried job (FAILED, then COMPLETED later) is fixed by the trailing safety pass', async () => {
    const ctx = await setup();
    const s = await sessionRow(ctx, 'kiosk');
    const now = Date.now();
    // 30 minutes apart: always two different 15-minute buckets.
    const failedAt = new Date(now - 30 * 60_000).toISOString();
    const id = await job(ctx, s.id, 'FAILED', failedAt, failedAt);
    await tick(48);
    expect((await bucketsOf(ctx.m.merchantId)).map((b) => b.event)).toEqual(['tryon_failed']);

    // The dispatcher's retry: FAILED → QUEUED → COMPLETED, finishing in a later bucket.
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED', completedAt: new Date() })
      .where(eq(schema.jobs.id, id));
    await tick();
    // The watermark-only pass rebuilt the new bucket but cannot know the old one went stale.
    expect((await bucketsOf(ctx.m.merchantId)).map((b) => b.event).sort()).toEqual([
      'tryon_completed',
      'tryon_failed',
    ]);
    await tick(48);
    expect((await bucketsOf(ctx.m.merchantId)).map((b) => b.event)).toEqual(['tryon_completed']);
  });

  it('two concurrent ticks never double-count', async () => {
    const ctx = await setup();
    await recordEvents(
      app.db,
      Array.from({ length: 5 }, (_, i) =>
        kioskEvent(ctx, 'session_started', `2026-11-07T08:0${i}:00Z`),
      ),
    );
    const results = await Promise.all([tick(), tick(), tick()]);
    expect(results.some((r) => !r.skipped)).toBe(true);
    await tick();
    const rows = await app.db
      .select()
      .from(schema.analyticsBuckets)
      .where(
        and(
          eq(schema.analyticsBuckets.merchantId, ctx.m.merchantId),
          eq(schema.analyticsBuckets.event, 'session_started'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(5);
  });

  it('advances the watermark', async () => {
    const [before] = await app.db.select().from(schema.analyticsRollupState);
    await tick();
    const [after] = await app.db.select().from(schema.analyticsRollupState);
    expect(after!.watermark.getTime()).toBeGreaterThanOrEqual(before!.watermark.getTime());
    expect(after!.watermark.getFullYear()).toBeGreaterThan(1970);
  });
});
