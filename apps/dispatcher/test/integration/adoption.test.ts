import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adoptionFixture } from '../helpers/adoption-fixture.js';

// A replacement dispatcher finishes a paid job whose prompt is still running (or finished)
// on the worker, instead of failing it. The dead owner is a real process killed with SIGKILL;
// the fake worker lives in this process and counts every POST.
describe('adoption of an in-flight paid job', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  beforeAll(async () => {
    f = await adoptionFixture('adopt');
  }, 60_000);
  beforeEach(() => f.reset());
  afterAll(() => f.close());

  const finishLater = (promptId: string, ms = 400, result: 'success' | 'error' = 'success') =>
    setTimeout(() => f.comfy.finishPrompt(promptId, result), ms);

  it('adopt-running: waits for the running prompt, completes it once, POSTs nothing, spends no retry', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    await f.expireLease(o.seeded.job.id);
    finishLater(o.promptId);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    const job = await f.jobRow(o.seeded.job.id);
    expect(job).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(await f.outputs(job.id)).toHaveLength(1);
    expect(f.comfy.postsFor(o.clientId)).toBe(1);
    expect(f.comfy.accepted()).toHaveLength(1);
    expect(await f.balance(o.seeded.user.id)).toBe(4);
    expect(await f.events(job.id, 'COMFY_ADOPT')).toHaveLength(1);
    // The hold was freed on evidence (the prompt ended), by the new owner.
    expect(await f.held()).toBeNull();
    expect((await f.attemptRow(o.attemptId)).resolvedAt).not.toBeNull();
  }, 60_000);

  it('adopt-finished: a prompt that finished while no owner existed is finalized without waiting', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.finishPrompt(o.promptId);
    await f.expireLease(o.seeded.job.id);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(await f.outputs(o.seeded.job.id)).toHaveLength(1);
    expect(f.comfy.accepted()).toHaveLength(1);
    expect(await f.held()).toBeNull();
  }, 60_000);

  it('adopt-then-cancelled: a cancel that lands during adoption ends already_terminal, no output, one refund', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    await f.expireLease(o.seeded.job.id);
    // What POST /jobs/:id/cancel does: status and refund in one transaction.
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
    }, 300);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    expect((await f.jobRow(o.seeded.job.id)).status).toBe('CANCELLED');
    expect(await f.outputs(o.seeded.job.id)).toEqual([]);
    expect(await f.balance(o.seeded.user.id)).toBe(5);
  }, 60_000);

  it('a receipt-less attempt whose prompt the worker holds is found by client id and adopted', async () => {
    f.comfy.setOptions({ holdPromptResponse: true, completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: false });
    await f.expireLease(o.seeded.job.id);
    finishLater(o.promptId);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(f.comfy.postsFor(o.clientId)).toBe(1);
    expect((await f.attemptRow(o.attemptId)).promptId).toBe(o.promptId);
    expect(await f.events(o.seeded.job.id, 'COMFY_RECEIPT_DISCOVERED')).toHaveLength(1);
  }, 60_000);

  it('a prompt that failed on the worker is a counted failure: one retry spent, requeued, no refund yet', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.finishPrompt(o.promptId, 'error');
    await f.expireLease(o.seeded.job.id);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(await f.balance(o.seeded.user.id)).toBe(4);
    expect(f.comfy.accepted()).toHaveLength(1);
    expect(await f.held()).toBeNull();
  }, 60_000);

  it('a prompt the worker lost (restart) is a counted failure, never a resubmission', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    f.comfy.forgetPrompt(o.promptId);
    await f.expireLease(o.seeded.job.id);

    await f.replacement(o.seeded.job.id, o.seeded.user.id);

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(f.comfy.accepted()).toHaveLength(1);
  }, 60_000);

  it('a live owner is never adopted from', async () => {
    f.comfy.setOptions({ completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: true });
    // The dead owner's lease has not expired.
    await f.replacement(o.seeded.job.id, o.seeded.user.id);
    expect((await f.jobRow(o.seeded.job.id)).status).toBe('PREPROCESSING');
    expect(await f.events(o.seeded.job.id, 'COMFY_ADOPT')).toEqual([]);
  }, 60_000);
});
