import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptPhone, phoneHash } from '../../src/modules/crm/crypto';
import { runCrmRetentionTick } from '../../src/modules/crm/retention';
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
