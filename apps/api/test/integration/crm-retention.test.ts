import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptPhone, phoneHash } from '../../src/modules/crm/crypto';
import { runCrmPhotoRetentionTick, runCrmRetentionTick } from '../../src/modules/crm/retention';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant } from '../helpers/merchant';

// CRM phase 2, plan Task 6: profile retention.

const KEY = randomBytes(32).toString('base64');
let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { CRM_DATA_KEY: KEY, CRM_IDENTIFY_ENABLED: true });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function merchant(profileRetentionDays: number | null) {
  const m = await createTestMerchant(app);
  if (profileRetentionDays !== null) {
    await app.db
      .insert(schema.merchantCrmSettings)
      .values({ merchantId: m.merchantId, photoRetentionDays: 30, profileRetentionDays });
  }
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  return { m, branch, device };
}

let n = 0;
async function shopper(ctx: Awaited<ReturnType<typeof merchant>>, lastSeenDaysAgo: number) {
  const phone = `9198${String(++n).padStart(8, '0')}`;
  const [s] = await app.db
    .insert(schema.shoppers)
    .values({
      merchantId: ctx.m.merchantId,
      phoneEnc: encryptPhone(KEY, phone),
      phoneHash: phoneHash(KEY, phone),
      displayName: 'Priya',
      lastSeenAt: sql`now() - make_interval(days => ${lastSeenDaysAgo})` as unknown as Date,
    })
    .returning();
  const [session] = await app.db
    .insert(schema.instoreSessions)
    .values({
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      mode: 'kiosk',
      shopperId: s!.id,
    })
    .returning();
  await app.db.insert(schema.shopperConsents).values({
    shopperId: s!.id,
    merchantId: ctx.m.merchantId,
    kind: 'looks',
    granted: true,
    version: 'v0-draft',
    source: 'whatsapp_button',
  });
  return { shopperId: s!.id, sessionId: session!.id };
}

const shopperRow = async (id: string) =>
  (await app.db.select().from(schema.shoppers).where(eq(schema.shoppers.id, id)))[0]!;
const sessionShopper = async (id: string) =>
  (await app.db.select().from(schema.instoreSessions).where(eq(schema.instoreSessions.id, id)))[0]!
    .shopperId;

describe('profile retention', () => {
  it("wipes only profiles past their own merchant's period, keeps consent history", async () => {
    const strict = await merchant(30);
    const lenient = await merchant(365);
    const undecided = await merchant(null);
    const old = await shopper(strict, 40);
    const recent = await shopper(strict, 5);
    const oldButLenient = await shopper(lenient, 40);
    const oldUndecided = await shopper(undecided, 4000);

    await runCrmRetentionTick(app);

    const wiped = await shopperRow(old.shopperId);
    expect(wiped).toMatchObject({ phoneEnc: null, phoneHash: null, displayName: null });
    expect(wiped.deletedAt).not.toBeNull();
    expect(await sessionShopper(old.sessionId)).toBeNull();
    const consents = await app.db
      .select()
      .from(schema.shopperConsents)
      .where(eq(schema.shopperConsents.shopperId, old.shopperId));
    expect(consents).toHaveLength(1);

    for (const kept of [recent, oldButLenient, oldUndecided]) {
      const row = await shopperRow(kept.shopperId);
      expect(row.deletedAt).toBeNull();
      expect(row.phoneHash).not.toBeNull();
      expect(await sessionShopper(kept.sessionId)).toBe(kept.shopperId);
    }
  });

  it('a second tick has nothing left to do', async () => {
    const m = await merchant(30);
    await shopper(m, 100);
    await runCrmRetentionTick(app);
    const again = await runCrmRetentionTick(app);
    expect(again.wiped).toBe(0);
  });

  it('after deletion the same number is a NEW shopper (the old hash is gone)', async () => {
    const m = await merchant(30);
    const old = await shopper(m, 100);
    await runCrmRetentionTick(app);
    const phone = `9198${String(n).padStart(8, '0')}`;
    const live = await app.db
      .select()
      .from(schema.shoppers)
      .where(eq(schema.shoppers.phoneHash, phoneHash(KEY, phone)));
    expect(live.find((s) => s.id === old.shopperId)).toBeUndefined();
  });
});

async function photoMerchant(photoRetentionDays: number | null) {
  const m = await createTestMerchant(app);
  if (photoRetentionDays !== null) {
    await app.db
      .insert(schema.merchantCrmSettings)
      .values({ merchantId: m.merchantId, photoRetentionDays, profileRetentionDays: 365 });
  }
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  return { m, branch, device };
}

/** A tablet session started `daysAgo` with one job whose photo and result really exist. */
async function sessionWithJob(
  ctx: Awaited<ReturnType<typeof photoMerchant>>,
  daysAgo: number,
  status: 'COMPLETED' | 'QUEUED' = 'COMPLETED',
) {
  const [session] = await app.db
    .insert(schema.instoreSessions)
    .values({
      merchantId: ctx.m.merchantId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      mode: 'kiosk',
      startedAt: sql`now() - make_interval(days => ${daysAgo})` as unknown as Date,
    })
    .returning();
  // Real key shapes: the storage router refuses keys with no routing rule.
  const id = randomUUID();
  const photo = keys.merchantTryonInput(ctx.m.merchantId, randomUUID(), 'jpg');
  const result = keys.output(id);
  const thumb = keys.outputThumb(id);
  for (const k of [photo, result, thumb])
    await app.storage.putObject(k, Buffer.from('x'), 'image/png');
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      id,
      merchantId: ctx.m.merchantId,
      userId: ctx.m.userId,
      status,
      creditsCharged: 5,
      source: 'merchant_tryon',
      sessionId: session!.id,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      customerPhotoKey: photo,
    })
    .returning();
  await app.db
    .insert(schema.jobOutputs)
    .values({ jobId: job!.id, resultKey: result, thumbnailKey: thumb });
  return { jobId: job!.id, keys: [photo, result, thumb] };
}

const exists = async (key: string) =>
  app.storage.headObject(key).then(
    () => true,
    () => false,
  );
const keysOf = async (jobId: string) => {
  const [j] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  const [o] = await app.db
    .select()
    .from(schema.jobOutputs)
    .where(eq(schema.jobOutputs.jobId, jobId));
  return [j!.customerPhotoKey, o!.resultKey, o!.thumbnailKey];
};

describe('photo retention (all in-store photos)', () => {
  it('deletes photo, result and thumbnail of sessions older than the period, and nulls the keys', async () => {
    const m = await photoMerchant(30);
    const old = await sessionWithJob(m, 31);
    const recent = await sessionWithJob(m, 29);
    const running = await sessionWithJob(m, 40, 'QUEUED');
    const undecided = await sessionWithJob(await photoMerchant(null), 4000);

    await runCrmPhotoRetentionTick(app);

    for (const k of old.keys) expect(await exists(k), k).toBe(false);
    expect(await keysOf(old.jobId)).toEqual([null, null, null]);
    // The job itself stays: history keeps its status and credits.
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, old.jobId));
    expect(job!.status).toBe('COMPLETED');

    for (const kept of [recent, running, undecided]) {
      for (const k of kept.keys) expect(await exists(k), k).toBe(true);
      expect(await keysOf(kept.jobId)).toEqual(kept.keys);
    }
  });

  it('a second tick finds nothing, and replicas never run it twice at once', async () => {
    const m = await photoMerchant(30);
    await sessionWithJob(m, 60);
    const [a, b] = await Promise.all([
      runCrmPhotoRetentionTick(app),
      runCrmPhotoRetentionTick(app),
    ]);
    expect(Math.min(a.jobs, b.jobs)).toBe(0);
    expect((await runCrmPhotoRetentionTick(app)).jobs).toBe(0);
  });
});
