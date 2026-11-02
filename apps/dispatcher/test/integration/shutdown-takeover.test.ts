import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_DRAIN_MS } from '../../src/shutdown.js';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { adoptionFixture } from '../helpers/adoption-fixture.js';
import { seedPaidJob } from '../helpers/paid-jobs.js';

// Planned deploys: the old process drains for at most 5 s, retires its rows and its consumer,
// and a replacement adopts the same prompt on its next recovery tick, without the 30-minute
// idle threshold. The old process is a real child receiving a real SIGTERM.
describe('shutdown drain and prompt takeover', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  const GROUP = 'dispatcher-cg';
  const stream = () => `jobs:shutdown-${f.workerId}`;
  const result = { '4': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } };

  beforeAll(async () => {
    f = await adoptionFixture('shutdown');
  }, 60_000);
  beforeEach(async () => {
    await f.reset();
    f.comfy.setOptions({ completionDelayMs: 600_000, outputs: result });
    await f.redis.del(stream());
    // XGROUP is not prefixed by ioredis, so name the prefixed key explicitly.
    await f.redis.call('XGROUP', 'CREATE', `${f.workerId}:${stream()}`, GROUP, '$', 'MKSTREAM');
  });
  afterAll(() => f.close());

  /** Puts a job's message in the PEL under a named consumer, as a delivered-but-unacked one. */
  async function pend(jobId: string, userId: string, consumer: string) {
    await f.redis.xadd(stream(), '*', 'jobId', jobId, 'userId', userId);
    await f.redis.xreadgroup('GROUP', GROUP, consumer, 'COUNT', 1, 'STREAMS', stream(), '>');
  }
  const owner = async (consumer: string) =>
    ((await f.redis.xpending(stream(), GROUP, '-', '+', 10)) as Array<[string, string]>).find(
      (e) => e[1] === consumer,
    );
  const control = async (jobId: string) =>
    (
      await f.env.db.execute(
        sql`select owner_retired, lease_until > clock_timestamp() as live from dispatcher_job_control where job_id = ${jobId}`,
      )
    )[0];

  it('SIGTERM: drains within 5 s, retires the row, and a replacement adopts the same prompt on its next tick', async () => {
    const o = await f.crashedOwner({
      withReceipt: true,
      leaveRunning: true,
      child: './shutdown-child.ts',
      env: { RES_TEST_DRAIN_MS: '5000' },
    });
    await pend(o.seeded.job.id, o.seeded.user.id, hostname());
    const started = Date.now();
    o.child.kill('SIGTERM');
    await o.exited;
    const took = Date.now() - started;

    // The job never finishes in the child, so the whole drain is spent, then it exits.
    expect(took).toBeGreaterThanOrEqual(4_500);
    expect(took).toBeLessThan(MAX_DRAIN_MS + 2_500);
    expect(await control(o.seeded.job.id)).toMatchObject({ owner_retired: true });
    expect(await f.redis.exists(`dispatcher:retired-consumer:${hostname()}`)).toBe(1);

    f.comfy.finishPrompt(o.promptId);
    await recoverPendingJobs(f.redis, f.processorCfg() as never, 3_600_000, f.log, [stream()]);

    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(f.comfy.postsFor(o.clientId)).toBe(1);
    expect(await f.balance(o.seeded.user.id)).toBe(4);
    expect(await f.events(o.seeded.job.id, 'COMFY_ADOPT')).toHaveLength(1);
  }, 60_000);

  it('SIGKILL: no marker, so eligibility comes from the expired lease alone', async () => {
    const o = await f.crashedOwner({
      withReceipt: true,
      child: './shutdown-child.ts',
    });
    await pend(o.seeded.job.id, o.seeded.user.id, 'some-dead-container');
    f.comfy.finishPrompt(o.promptId);

    // The lease is still live: not claimable, whatever the idle time.
    await recoverPendingJobs(f.redis, f.processorCfg() as never, 3_600_000, f.log, [stream()]);
    expect(await owner('some-dead-container')).toBeDefined();
    expect((await f.jobRow(o.seeded.job.id)).status).toBe('PREPROCESSING');

    await f.expireLease(o.seeded.job.id);
    await recoverPendingJobs(f.redis, f.processorCfg() as never, 3_600_000, f.log, [stream()]);
    expect(await f.jobRow(o.seeded.job.id)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
    expect(f.comfy.postsFor(o.clientId)).toBe(1);
  }, 60_000);

  it("a live owner's entry is never taken, however small the threshold", async () => {
    const o = await f.crashedOwner({
      withReceipt: true,
      leaveRunning: true,
      child: './shutdown-child.ts',
    });
    await pend(o.seeded.job.id, o.seeded.user.id, 'other-live-container');
    await recoverPendingJobs(f.redis, f.processorCfg() as never, 0, f.log, [stream()]);
    // Threshold 0 claims it, but acquisition sees the live lease and does nothing.
    expect((await f.jobRow(o.seeded.job.id)).status).toBe('PREPROCESSING');
    expect(await f.events(o.seeded.job.id, 'COMFY_ADOPT')).toEqual([]);
    expect((await control(o.seeded.job.id))?.live).toBe(true);
    o.child.kill('SIGKILL');
    await o.exited;
  }, 60_000);

  it('a claim made but never started by a drained consumer is recovered at once and runs normally', async () => {
    const { user, job } = await seedPaidJob(f.env, 'regular');
    await pend(job.id, user.id, hostname());
    await f.redis.set(`dispatcher:retired-consumer:${hostname()}`, '1', 'EX', 60);
    await recoverPendingJobs(f.redis, f.processorCfg() as never, 3_600_000, f.log, [stream()]);
    // The unstarted claim was taken straight away: the job was acquired (it has a control row)
    // instead of waiting out the idle threshold.
    expect(await control(job.id)).toBeDefined();
  }, 60_000);

  it('the compose stop grace exceeds the drain in prod and staging', () => {
    for (const file of ['docker-compose.prod.yml', 'docker-compose.staging.yml']) {
      const text = readFileSync(new URL(`../../../../infra/${file}`, import.meta.url), 'utf8');
      const block = text.slice(text.indexOf('\n  dispatcher:\n'));
      const grace = /stop_grace_period:\s*(\d+)s/.exec(
        block.slice(0, block.indexOf('\n  web:') > 0 ? block.indexOf('\n  web:') : undefined),
      );
      expect(Number(grace?.[1]) * 1000).toBeGreaterThan(MAX_DRAIN_MS);
    }
  });
});
