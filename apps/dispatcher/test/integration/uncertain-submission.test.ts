import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adoptionFixture } from '../helpers/adoption-fixture.js';

// The POST may have been accepted with its reply lost. The search window is persisted once,
// on database time, and restarts never extend it.
describe('uncertain submission across restarts', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  beforeAll(async () => {
    f = await adoptionFixture('uncertain');
  }, 60_000);
  beforeEach(() => f.reset());
  afterAll(() => f.close());

  it('uncertain-deadline-survives-restart: the window is not reset, then absence after it retries once', async () => {
    f.comfy.setOptions({ holdPromptResponse: true, completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: false });
    // The worker never actually kept it, and is unreadable for the first replacement.
    f.comfy.forgetPrompt(o.promptId);
    f.comfy.setOptions({ queueStatus: 503 });
    await f.expireLease(o.seeded.job.id);

    await f.replacement(o.seeded.job.id, o.seeded.user.id, { uncertainCheckMs: 1_200 });
    const first = (await f.attemptRow(o.attemptId)).uncertainDeadline;
    expect(first).not.toBeNull();
    // Past the deadline but the worker could not be read: fail closed, nothing counted.
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'PREPROCESSING', attempts: 0 });
    expect((await f.attemptRow(o.attemptId)).state).toBe('SUBMITTING');
    expect(await f.held()).not.toBeNull();

    // A second restart, with a window that would be 10 minutes if it were recomputed.
    f.comfy.setOptions({});
    await f.expireLease(o.seeded.job.id);
    await f.replacement(o.seeded.job.id, o.seeded.user.id, { uncertainCheckMs: 600_000 });

    expect((await f.attemptRow(o.attemptId)).uncertainDeadline?.getTime()).toBe(first?.getTime());
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(await f.attemptRow(o.attemptId)).toMatchObject({ state: 'UNKNOWN_RETRIED' });
    expect((await f.attemptRow(o.attemptId)).resolvedAt).not.toBeNull();
    expect(f.comfy.postsFor(o.clientId)).toBe(1);
    expect(await f.held()).toBeNull();
    expect(await f.balance(o.seeded.user.id)).toBe(4);
  }, 60_000);

  it('before the deadline an absent prompt is not retried: the search keeps going', async () => {
    f.comfy.setOptions({ holdPromptResponse: true, completionDelayMs: 600_000 });
    const o = await f.crashedOwner({ withReceipt: false });
    f.comfy.forgetPrompt(o.promptId);
    await f.expireLease(o.seeded.job.id);
    // Deadline far away: the replacement must still be searching when the test moves it.
    const run = f.replacement(o.seeded.job.id, o.seeded.user.id, { uncertainCheckMs: 600_000 });
    await new Promise((r) => setTimeout(r, 800));
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ attempts: 0 });
    expect((await f.attemptRow(o.attemptId)).state).toBe('SUBMITTING');
    await f.env.db.execute(
      sql`update execution_attempts set uncertain_deadline = clock_timestamp() - interval '1 second' where id = ${o.attemptId}`,
    );
    await run;
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
  }, 60_000);
});
