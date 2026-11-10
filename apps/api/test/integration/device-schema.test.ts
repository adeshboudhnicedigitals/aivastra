import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestMerchant } from '../helpers/merchant';

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

describe('device schema', () => {
  it('stores a device, a session and an item, and a legacy-shaped job still inserts with null attribution', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const [device] = await app.db
      .insert(schema.merchantDevices)
      .values({ merchantId: m.merchantId, branchId: b.id, name: 'Front tablet' })
      .returning();
    expect(device).toMatchObject({ isActive: true, deviceTokenHash: null, lastSeenAt: null });

    const [session] = await app.db
      .insert(schema.instoreSessions)
      .values({ merchantId: m.merchantId, branchId: b.id, deviceId: device!.id, mode: 'kiosk' })
      .returning();
    expect(session!.endedAt).toBeNull();
    expect(session!.lastActivityAt).toBeInstanceOf(Date);

    const [item] = await app.db
      .insert(schema.sessionItems)
      .values({ sessionId: session!.id, catalogItemId: randomUUID(), action: 'wishlisted' })
      .returning();
    expect(item).toMatchObject({ voidedAt: null, jobId: null, staffId: null });

    // Compatibility: a job inserted exactly as legacy code does must still work.
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({
      id: jobId,
      userId: m.userId,
      merchantId: m.merchantId,
      status: 'QUEUED',
      creditsCharged: 5,
      source: 'merchant_tryon',
    });
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ branchId: null, deviceId: null, sessionId: null, staffId: null });
  });

  it('pairing_code_hash is unique when set; NULL hashes may repeat', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const mk = (pairingCodeHash: string | null) =>
      app.db
        .insert(schema.merchantDevices)
        .values({ merchantId: m.merchantId, branchId: b.id, name: 'd', pairingCodeHash })
        .returning();
    await mk(null);
    await mk(null);
    const hash = randomUUID();
    await mk(hash);
    await expect(mk(hash)).rejects.toThrow();
  });
});
