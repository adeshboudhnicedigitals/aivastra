import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSweeper } from '../../src/stream/sweeper.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/**
 * Held bulk-flat jobs are created now and released days later. The sweeper's
 * QUEUED staleness must date from the release (queued_at), not from creation —
 * otherwise every released batch is failed-and-refunded on the next tick.
 */
describe('sweeper — held-then-released jobs', () => {
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

  async function seedJob(values: Partial<typeof schema.jobs.$inferInsert>): Promise<string> {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `held-${randomUUID()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 0 });

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, creditsCharged: 20, source: 'merchant_catalog', ...values })
      .returning();
    return job?.id as string;
  }

  async function statusOf(jobId: string): Promise<string> {
    const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return row?.status as string;
  }

  it('spares a job released seconds ago even though it was created days ago', async () => {
    const log = createLogger('test');

    const justReleased = await seedJob({
      status: 'QUEUED',
      createdAt: new Date(Date.now() - 3 * DAY),
      queuedAt: new Date(),
    });
    const stillHeld = await seedJob({
      status: 'HELD',
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    const genuinelyOrphaned = await seedJob({
      status: 'QUEUED',
      createdAt: new Date(Date.now() - 3 * DAY),
    });

    await runSweeper(env.db, pub, log);

    expect(await statusOf(justReleased)).toBe('QUEUED');
    // HELD is not QUEUED and not in-flight — the sweeper must never touch it.
    expect(await statusOf(stillHeld)).toBe('HELD');
    // Control: without queued_at, a 3-day-old QUEUED job is still swept.
    expect(await statusOf(genuinelyOrphaned)).toBe('FAILED');
  });

  it('sweeps a released job once it exceeds the SLA measured from queued_at', async () => {
    const log = createLogger('test');

    const staleRelease = await seedJob({
      status: 'QUEUED',
      createdAt: new Date(Date.now() - 3 * DAY),
      queuedAt: new Date(Date.now() - 12 * MIN),
    });

    await runSweeper(env.db, pub, log);

    expect(await statusOf(staleRelease)).toBe('FAILED');
  });
});
