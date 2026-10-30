import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSweeper } from '../../src/stream/sweeper.js';
import { adoptionFixture } from '../helpers/adoption-fixture.js';

// The stuck-job sweeper hands an expired paid-Comfy job to the same adoption path recovery
// uses. Every case here has no live lease and no message pending in Redis: the sweeper has
// nothing to ACK, and age alone must not decide what happened on the worker.
describe('sweeper routes expired paid jobs through adoption', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  beforeAll(async () => {
    f = await adoptionFixture('sweep');
  }, 60_000);
  beforeEach(() => f.reset());
  afterAll(() => f.close());

  const sweep = () => runSweeper(f.env.db, f.redis, f.redis, f.log, randomUUID(), f.processorCfg());

  /** Past the 15 minute SLA, with the dead owner's lease expired. */
  async function expire(jobId: string) {
    await f.expireLease(jobId);
    await f.env.db
      .update(schema.jobs)
      .set({
        createdAt: sql`now() - interval '1 hour'`,
        startedAt: sql`now() - interval '1 hour'`,
      })
      .where(eq(schema.jobs.id, jobId));
  }
  const nothingPending = async () => expect(await f.redis.xlen('jobs:normal')).toBe(0);

  it('sweeper-finalizes-finished-history: the GPU finished the image, so one output and COMPLETED, no refund', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.finishPrompt(o.promptId);
    await expire(o.seeded.job.id);

    await sweep();

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(await f.outputs(o.seeded.job.id)).toHaveLength(1);
    expect(await f.balance(o.seeded.user.id)).toBe(4);
    expect(f.comfy.accepted()).toHaveLength(1);
    await nothingPending();
  }, 60_000);

  it('sweeper-leaves-running-prompt: no status change and no refund while it runs; settled once it finishes', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    await expire(o.seeded.job.id);

    const before = (await f.jobRow(o.seeded.job.id)).status;
    const swept = sweep();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: before, attempts: 0 });
    expect(await f.balance(o.seeded.user.id)).toBe(4);

    f.comfy.finishPrompt(o.promptId);
    await swept;
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED' });
    expect(await f.outputs(o.seeded.job.id)).toHaveLength(1);
    expect(await f.balance(o.seeded.user.id)).toBe(4);
    await nothingPending();
  }, 60_000);

  it('sweeper-fails-genuinely-dead: a lost prompt with no retry left is FAILED with exactly one refund', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.forgetPrompt(o.promptId);
    // One failure already spent: this one is the last the budget allows.
    await f.env.db
      .update(schema.jobs)
      .set({ attempts: 1 })
      .where(eq(schema.jobs.id, o.seeded.job.id));
    await expire(o.seeded.job.id);

    await sweep();

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(await f.balance(o.seeded.user.id)).toBe(5);
    const refunds = await f.env.db
      .select()
      .from(schema.creditLedger)
      .where(
        sql`${schema.creditLedger.jobId} = ${o.seeded.job.id} and ${schema.creditLedger.delta} > 0`,
      );
    expect(refunds).toHaveLength(1);
    expect(f.comfy.accepted()).toHaveLength(1);
  }, 60_000);

  it('sweeper-vs-cancel: a cancel during the sweep ends already_terminal with one refund', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    await expire(o.seeded.job.id);
    setTimeout(async () => {
      await f.env.db.transaction(async (tx) => {
        await tx
          .update(schema.jobs)
          .set({ status: 'CANCELLED' })
          .where(eq(schema.jobs.id, o.seeded.job.id));
        await tx
          .update(schema.userCredits)
          .set({ balance: 5 })
          .where(eq(schema.userCredits.userId, o.seeded.user.id));
      });
      f.comfy.finishPrompt(o.promptId);
    }, 600);

    await sweep();

    expect((await f.jobRow(o.seeded.job.id)).status).toBe('CANCELLED');
    expect(await f.outputs(o.seeded.job.id)).toEqual([]);
    expect(await f.balance(o.seeded.user.id)).toBe(5);
  }, 60_000);

  it('a job with no attempt record keeps the age rule', async () => {
    const seeded = await (await import('../helpers/paid-jobs.js')).seedPaidJob(f.env, 'regular');
    await f.env.db
      .update(schema.jobs)
      .set({ status: 'GENERATING' })
      .where(eq(schema.jobs.id, seeded.job.id));
    await expire(seeded.job.id);
    await sweep();
    expect((await f.jobRow(seeded.job.id)).status).toBe('FAILED');
    expect(await f.balance(seeded.user.id)).toBe(5);
  }, 60_000);
});
