import { schema } from '@aivastra/db';
import { capabilitiesKey, comfyVersionKey } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { COMFY_TIMEOUT_CONFIG_KEY } from '../../src/config/comfy-timeout.js';
import { type ProcessorConfig, processJob } from '../../src/job/processor.js';
import { getWorkers, routingConfigKey } from '../../src/worker/registry.js';
import type { ComfyMock } from './comfy-mock.js';

/** Real polling + real local billing: exercise each caller, not just a mocked status switch. */
export async function assertQueueExhaustion(
  cfg: ProcessorConfig,
  comfy: ComfyMock,
  workerId: string,
  jobId: string,
  userId: string,
): Promise<void> {
  const { db, redis } = cfg;
  const [before] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!before) throw new Error('missing job fixture');
  let billingUserId = before.userId;
  if (before.merchantId) {
    const [merchant] = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, before.merchantId));
    billingUserId = merchant?.userId ?? null;
  }
  const balance = async () => {
    if (before.shopifyStoreId) {
      const [credits] = await db
        .select()
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, before.shopifyStoreId));
      return credits?.balance ?? 0;
    }
    if (!billingUserId) return 0;
    const [credits] = await db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, billingUserId));
    return credits?.balance ?? 0;
  };
  if (before.shopifyStoreId) {
    await db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: before.shopifyStoreId, balance: 5 })
      .onConflictDoNothing();
  }
  if (billingUserId && before.creditsCharged > 0) {
    await db
      .insert(schema.userCredits)
      .values({ userId: billingUserId, balance: 5 })
      .onConflictDoNothing();
  }
  const balanceBefore = await balance();
  const keys = [
    COMFY_TIMEOUT_CONFIG_KEY,
    capabilitiesKey(workerId),
    comfyVersionKey(workerId),
    routingConfigKey(workerId),
  ];
  const previous = await Promise.all(keys.map((key) => redis.get(key)));
  const deleteCount = comfy.deleteCalls().length;
  const interruptCount = comfy.interruptCalls().length;
  comfy.setOptions({ startDelayMs: 100_000, completionDelayMs: 100_000 });
  try {
    await redis.set(
      COMFY_TIMEOUT_CONFIG_KEY,
      JSON.stringify({
        maxQueueWaitMs: 1,
        queueStateUnknownGraceMs: 1,
        queueCleanupTimeoutMs: 6_001,
      }),
    );
    await redis.set(
      capabilitiesKey(workerId),
      JSON.stringify({
        queuePromptIdentityValidated: true,
        queueDeleteValidated: true,
        validatedComfyVersion: '0.37.0',
        validatedAt: '2026-10-01',
      }),
    );
    await redis.setex(comfyVersionKey(workerId), 60, '0.37.0');
    await redis.set(routingConfigKey(workerId), JSON.stringify({ queueGateEnabled: true }));
    await redis.setex(`worker:health:${workerId}`, 30, '1');
    const queuedBefore = await redis.xlen('jobs:normal');
    await processJob(cfg, jobId, userId, 'jobs:normal', '3-1');
    const [after] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('FAILED');
    expect(after?.errorCode).toBe('QUEUE_CLEANUP_FAILED');
    expect(after?.attempts).toBe(before.attempts);
    expect(await balance()).toBe(balanceBefore + before.creditsCharged);
    expect(
      await db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
    ).toEqual([]);
    expect((await getWorkers(redis)).get(workerId)?.status).toBe('IDLE');
    expect(await redis.xlen('jobs:normal')).toBe(queuedBefore);
    expect(comfy.deleteCalls()).toHaveLength(deleteCount + 1);
    expect(comfy.interruptCalls()).toHaveLength(interruptCount);
    // A duplicate stream delivery of this terminal job cannot grant another refund.
    await processJob(cfg, jobId, userId, 'jobs:normal', '3-2');
    expect(await balance()).toBe(balanceBefore + before.creditsCharged);
  } finally {
    for (const [index, key] of keys.entries()) {
      const raw = previous[index];
      if (raw === null || raw === undefined) await redis.del(key);
      else await redis.set(key, raw);
    }
  }
}
