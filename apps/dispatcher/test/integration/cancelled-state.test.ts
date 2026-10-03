import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { transitionJob } from '../../src/job/state.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

let env: TestEnv;
const publish = vi.fn(async () => 0);
const pub = { publish } as unknown as Redis;
const log = createLogger('test');
beforeAll(async () => {
  env = await setupTestEnv();
}, 60_000);
afterAll(async () => {
  await env?.cleanup();
});
async function seed(status: string) {
  const [user] = await env.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@test.com` })
    .returning();
  const [job] = await env.db
    .insert(schema.jobs)
    .values({ userId: user.id, status, creditsCharged: 1 })
    .returning();
  return { jobId: job.id, userId: user.id };
}

it('intermediate and completion transitions preserve CANCELLED with no outputs or SSE', async () => {
  const { jobId, userId } = await seed('CANCELLED');
  publish.mockClear();
  for (const status of ['PREPROCESSING', 'GENERATING', 'UPLOADING', 'COMPLETED'] as const) {
    expect(
      await transitionJob(
        env.db,
        pub,
        jobId,
        userId,
        status,
        { resultKey: 'private/test.png' },
        log,
      ),
    ).toBe(false);
  }
  expect(publish).not.toHaveBeenCalled();
  expect(
    await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
  ).toEqual([]);
  expect(
    await env.db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, jobId)),
  ).toEqual([]);
  const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  expect(job.status).toBe('CANCELLED');
});

it('FAILED to QUEUED retry remains allowed', async () => {
  const { jobId, userId } = await seed('FAILED');
  expect(await transitionJob(env.db, pub, jobId, userId, 'QUEUED', {}, log)).toBe(true);
  const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  expect(job.status).toBe('QUEUED');
});

it('completion waiting on an uncommitted cancellation observes the cancelled row after the lock releases', async () => {
  const { jobId, userId } = await seed('GENERATING');
  let unlock: () => void = () => {};
  let locked: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const cancellation = env.db.transaction(async (tx) => {
    await tx.update(schema.jobs).set({ status: 'CANCELLED' }).where(eq(schema.jobs.id, jobId));
    locked();
    await release;
  });
  await ready;
  publish.mockClear();
  const completion = transitionJob(
    env.db,
    pub,
    jobId,
    userId,
    'COMPLETED',
    { resultKey: 'private/test.png' },
    log,
  );
  unlock();
  await cancellation;
  expect(await completion).toBe(false);
  expect(publish).not.toHaveBeenCalled();
  expect(
    await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
  ).toEqual([]);
});
