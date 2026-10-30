import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adoptionFixture } from '../helpers/adoption-fixture.js';
import { PATH_FIXTURE_KEY, seedPaidJob } from '../helpers/paid-jobs.js';

// A /history poll that times out, errors or answers 5xx is "unknown this round": the prompt is
// usually still running on the GPU. Only a sustained outage (or a real ComfyUI error) fails a job.
describe('progress poll tolerance', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  beforeAll(async () => {
    f = await adoptionFixture('poll');
    await f.env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);
  beforeEach(async () => {
    await f.reset();
    // Short limits so the tests do not wait the production 10 s / 30 s.
    await f.redis.set(
      'config:comfy-timeout',
      JSON.stringify({ pollRequestTimeoutMs: 300, pollOutageMs: 1_500, pollOutageMinFailures: 3 }),
    );
  });
  afterAll(() => f.close());

  // The seeded template's result node is '4'.
  const outputs = { '4': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } };
  const run = async (extra: Record<string, unknown> = {}, jobOpts: { attempts?: number } = {}) => {
    const seeded = await seedPaidJob(f.env, 'regular');
    if (jobOpts.attempts)
      await f.env.db
        .update(schema.jobs)
        .set({ attempts: jobOpts.attempts })
        .where(eq(schema.jobs.id, seeded.job.id));
    await f.replacement(seeded.job.id, seeded.user.id, { comfyPollIntervalMs: 50, ...extra });
    return seeded;
  };
  const refunds = (jobId: string) =>
    f.env.db
      .select()
      .from(schema.creditLedger)
      .where(sql`${schema.creditLedger.jobId} = ${jobId} and ${schema.creditLedger.delta} > 0`);

  it('slow-poll-tolerated: one poll that outlasts the request timeout is retried; COMPLETED, no refund, no retry', async () => {
    f.comfy.setOptions({
      outputs,
      completionDelayMs: 300,
      historyPollFault: (n) => (n === 1 ? 'hang' : undefined),
    });
    const s = await run();
    expect(await f.jobRow(s.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(await refunds(s.job.id)).toHaveLength(0);
    expect(f.comfy.accepted()).toHaveLength(1);
  }, 60_000);

  it('flapping-poll-tolerated: alternating failed and good polls never reach the outage limit', async () => {
    f.comfy.setOptions({
      outputs,
      completionDelayMs: 2_500,
      historyPollFault: (n) => (n % 2 === 1 ? (n % 4 === 1 ? 'drop' : '500') : undefined),
    });
    const s = await run();
    expect(await f.jobRow(s.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(await refunds(s.job.id)).toHaveLength(0);
  }, 60_000);

  it('4xx-is-not-an-outage: polls answered 4xx for longer than the outage limit do not fail the job', async () => {
    // 50 ms interval x 60 polls is ~3 s of 403s, twice the 1.5 s limit; the job then completes.
    f.comfy.setOptions({
      outputs,
      completionDelayMs: 300,
      historyPollFault: (n) => (n <= 60 ? '403' : undefined),
    });
    const s = await run({}, { attempts: 1 });
    expect(await f.jobRow(s.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 1 });
    expect(await refunds(s.job.id)).toHaveLength(0);
  }, 60_000);

  it('sustained-poll-outage: polls failing past the limit fail the job through the normal path with one refund, and name the count and last error', async () => {
    f.comfy.setOptions({ completionDelayMs: 60_000, historyPollFault: () => 'drop' });
    // The job's one retry is already spent, so this failure is final.
    const s = await run({}, { attempts: 1 });
    const job = await f.jobRow(s.job.id);
    expect(job).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(await refunds(s.job.id)).toHaveLength(1);
    expect(await f.balance(s.user.id)).toBe(5);
    expect(JSON.stringify(job)).toMatch(/consecutive failed polls/);
    expect(JSON.stringify(job)).toMatch(/last error/);
  }, 60_000);

  it('sustained-poll-outage on a job with a retry left spends one retry and requeues, no refund', async () => {
    f.comfy.setOptions({ completionDelayMs: 60_000, historyPollFault: () => 'drop' });
    const s = await run();
    expect(await f.jobRow(s.job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(await refunds(s.job.id)).toHaveLength(0);
  }, 60_000);

  it('execution-error-still-immediate: a ComfyUI execution error fails on the first poll', async () => {
    f.comfy.setOptions({ fail: true });
    const startedAt = Date.now();
    const s = await run({}, { attempts: 1 });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    const job = await f.jobRow(s.job.id);
    expect(job.status).toBe('FAILED');
    expect(JSON.stringify(job)).toMatch(/execution error/);
    expect(await refunds(s.job.id)).toHaveLength(1);
  }, 60_000);
});
