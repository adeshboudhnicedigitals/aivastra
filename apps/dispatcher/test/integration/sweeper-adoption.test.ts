import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { laneOccupancy } from '../../src/stream/lane-tickets.js';
import { runStreamLoop } from '../../src/stream/loop.js';
import { runSweeper, sweeperIdle } from '../../src/stream/sweeper.js';
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

  const tick = () => runSweeper(f.env.db, f.redis, f.redis, f.log, randomUUID(), f.processorCfg());
  /** One tick, then the adoptions it started (they run in the background). */
  const sweep = async () => {
    await tick();
    await sweeperIdle();
  };

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
    await tick();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: before, attempts: 0 });
    expect(await f.balance(o.seeded.user.id)).toBe(4);

    f.comfy.finishPrompt(o.promptId);
    await sweeperIdle();
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

  it('a running prompt does not block the tick: another stuck job is handled in the same tick, and a second tick skips the first', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const slow = await f.crashedOwner({ withReceipt: true });
    const slowPrompt = slow.promptId;
    await expire(slow.seeded.job.id);
    // A second stuck job whose prompt already finished, on a worker with a hold of its own.
    await f.reset();
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const quick = await f.crashedOwner({ withReceipt: true });
    f.comfy.finishPrompt(quick.promptId);
    await expire(quick.seeded.job.id);

    const startedAt = Date.now();
    await tick();
    // The tick returned although the first adoption is still waiting on its prompt.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    for (let i = 0; i < 100; i++) {
      if ((await f.jobRow(quick.seeded.job.id)).status === 'COMPLETED') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await f.jobRow(quick.seeded.job.id)).status).toBe('COMPLETED');
    const slowRow = await f.jobRow(slow.seeded.job.id);
    expect(['PREPROCESSING', 'GENERATING']).toContain(slowRow.status);

    // The adopted job holds a live lease: another tick leaves it alone (no second takeover).
    const before = await f.env.db.execute(
      sql`select generation::int g from dispatcher_job_control where job_id = ${slow.seeded.job.id}`,
    );
    await tick();
    const after = await f.env.db.execute(
      sql`select generation::int g from dispatcher_job_control where job_id = ${slow.seeded.job.id}`,
    );
    expect(after[0]?.g).toBe(before[0]?.g);

    f.comfy.finishPrompt(slowPrompt);
    await sweeperIdle();
    expect((await f.jobRow(slow.seeded.job.id)).status).toBe('COMPLETED');
  }, 90_000);

  it('sweeper-counts-against-the-cap: an adopted job occupies a slot of its lane while it runs, so a full cap admits no fresh read', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    await expire(o.seeded.job.id);

    await tick();
    expect(laneOccupancy('gpu')).toBe(1);

    // One worker, one slot: the lane is full while the adoption runs.
    let reads = 0;
    const stop = runStreamLoop(f.processorCfg() as never, f.log, {
      name: 'gpu',
      read: async () => {
        reads++;
        await new Promise((r) => setTimeout(r, 20));
        return null;
      },
      getConcurrency: async () => 1,
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(reads).toBe(0);

    f.comfy.finishPrompt(o.promptId);
    await sweeperIdle();
    expect(laneOccupancy('gpu')).toBe(0);
    await new Promise((r) => setTimeout(r, 400));
    stop();
    expect(reads).toBeGreaterThan(0);
  }, 60_000);

  it('sweeper-requeues-with-a-real-message: a retried job gets a replacement message with its userId, not a lost one', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.forgetPrompt(o.promptId);
    await expire(o.seeded.job.id);

    await sweep();

    // The lost prompt costs one retry, so the job goes back to its own lane with a fresh message.
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    const entries = await f.redis.xrange('jobs:normal', '-', '+');
    expect(entries).toHaveLength(1);
    const fields = entries[0]?.[1] ?? [];
    expect(fields).toContain(o.seeded.job.id);
    expect(fields).toContain(o.seeded.user.id);
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
