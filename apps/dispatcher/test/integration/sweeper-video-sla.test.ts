import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSweeper } from '../../src/stream/sweeper.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const MIN = 60 * 1000;

/**
 * Catalog-video jobs are capped by VIDEO_CONCURRENCY (matched to the PixVerse plan),
 * not by GPU worker count, and each takes ~3-5 min. A burst therefore queues far
 * longer than a GPU job legitimately would, so they get a 30-minute QUEUED SLA rather
 * than the standard 10 — otherwise the sweeper refunds healthy work about to run.
 */
describe('sweeper — per-source QUEUED SLA', () => {
  let env: TestEnv;
  let pub: Redis;

  beforeAll(async () => {
    env = await setupTestEnv();
    pub = new Redis('redis://127.0.0.1:6379');
  }, 60_000);

  afterAll(async () => {
    pub.disconnect();
    await env.cleanup();
  });

  async function seedQueuedJob(source: string | null, ageMs: number): Promise<string> {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `sweep-${randomUUID()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 0 });

    const [job] = await env.db
      .insert(schema.jobs)
      .values({
        userId: user?.id,
        status: 'QUEUED',
        creditsCharged: 20,
        source,
        createdAt: new Date(Date.now() - ageMs),
      })
      .returning();
    return job?.id as string;
  }

  async function statusOf(jobId: string): Promise<string> {
    const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return row?.status as string;
  }

  it('sweeps non-video jobs at 10 min but spares video jobs until 30 min', async () => {
    const log = createLogger('test');

    const tryonId = await seedQueuedJob('tryon', 12 * MIN);
    const legacyId = await seedQueuedJob(null, 12 * MIN); // nullable source — COALESCE branch
    const videoId = await seedQueuedJob('catalog_video', 12 * MIN);

    await runSweeper(env.db, pub, log);

    expect(await statusOf(tryonId)).toBe('FAILED');
    // A bare `source <> 'catalog_video'` would be NULL here and silently skip the row.
    expect(await statusOf(legacyId)).toBe('FAILED');
    expect(await statusOf(videoId)).toBe('QUEUED');

    // Past its own SLA, the video job sweeps too.
    await env.db
      .update(schema.jobs)
      .set({ createdAt: new Date(Date.now() - 35 * MIN) })
      .where(eq(schema.jobs.id, videoId));

    await runSweeper(env.db, pub, log);
    expect(await statusOf(videoId)).toBe('FAILED');
  });

  it('refunds credits for a swept video job', async () => {
    const log = createLogger('test');
    const videoId = await seedQueuedJob('catalog_video', 35 * MIN);
    const [before] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, videoId));

    await runSweeper(env.db, pub, log);

    expect(await statusOf(videoId)).toBe('FAILED');
    const [bal] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, before?.userId as string));
    expect(bal.balance).toBe(20);
  });
});
