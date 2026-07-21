import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessorConfig } from '../../src/job/processor.js';
import { promoteSareeStep2Jobs } from '../../src/job/saree-step2-promoter.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

describe('promoteSareeStep2Jobs', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let cfg: ProcessorConfig;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    cfg = {
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log: createLogger('dispatcher-test'),
    };
  }, 60_000);

  afterAll(async () => {
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    await redis.del('jobs:normal');
  });

  async function seedUser() {
    const [user] = await cfg.db
      .insert(schema.users)
      .values({
        email: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@x.com`,
        passwordHash: 'x',
        tier: 'free',
      })
      .returning();
    return user.id;
  }

  it('promotes a PENDING_MANNEQUIN job once its mannequin parent is COMPLETED', async () => {
    const userId = await seedUser();
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'COMPLETED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    await promoteSareeStep2Jobs(cfg);

    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('QUEUED');
    const [updatedInputs] = await cfg.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, step2Job.id));
    expect(updatedInputs?.upperGarmentKey).toBe(keys.output(mannequinJob.id));
    const streamLen = await cfg.redis.xlen('jobs:normal');
    expect(streamLen).toBe(1);
  });

  it('refunds and fails a PENDING_MANNEQUIN job whose mannequin parent FAILED', async () => {
    const userId = await seedUser();
    await cfg.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'FAILED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });
    const [before] = await cfg.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));

    await promoteSareeStep2Jobs(cfg);

    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('FAILED');
    expect(updatedJob?.errorCode).toBe('MANNEQUIN_STEP_FAILED');
    const [after] = await cfg.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(after?.balance).toBe((before?.balance ?? 0) + 25);
  });

  it('refunds and fails a PENDING_MANNEQUIN job whose mannequin parent was CANCELLED', async () => {
    const userId = await seedUser();
    await cfg.db.insert(schema.userCredits).values({ userId, balance: 50 });
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'CANCELLED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 10,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    await promoteSareeStep2Jobs(cfg);

    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('FAILED');
    expect(updatedJob?.errorCode).toBe('MANNEQUIN_STEP_FAILED');
    const [after] = await cfg.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(after?.balance).toBe(60);
  });

  it('leaves a PENDING_MANNEQUIN job untouched while its mannequin parent is still in flight', async () => {
    const userId = await seedUser();
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'GENERATING',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    await promoteSareeStep2Jobs(cfg);

    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('PENDING_MANNEQUIN');
    const streamLen = await cfg.redis.xlen('jobs:normal');
    expect(streamLen).toBe(0);
  });

  it('is idempotent — running twice does not re-queue or double-refund', async () => {
    const userId = await seedUser();
    await cfg.db.insert(schema.userCredits).values({ userId, balance: 0 });
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'COMPLETED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    await promoteSareeStep2Jobs(cfg);
    await promoteSareeStep2Jobs(cfg);

    const streamLen = await cfg.redis.xlen('jobs:normal');
    expect(streamLen).toBe(1);
    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('QUEUED');
  });

  it('promotes exactly once when two sweeps run genuinely concurrently (Promise.all)', async () => {
    const userId = await seedUser();
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'COMPLETED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    // Genuinely overlapping invocations (not sequential) — simulates two
    // 5s-interval sweep ticks racing each other over the same row. Only one
    // must win the atomic claim in the COMPLETED branch.
    await Promise.all([promoteSareeStep2Jobs(cfg), promoteSareeStep2Jobs(cfg)]);

    const streamLen = await cfg.redis.xlen('jobs:normal');
    expect(streamLen).toBe(1);
    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('QUEUED');
  });

  it('refunds exactly once across two invocations for a FAILED mannequin parent', async () => {
    const userId = await seedUser();
    await cfg.db.insert(schema.userCredits).values({ userId, balance: 0 });
    const [mannequinJob] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'FAILED',
        source: 'saree_mannequin',
        creditsCharged: 0,
        queueStream: 'normal',
      })
      .returning();
    const [step2Job] = await cfg.db
      .insert(schema.jobs)
      .values({
        userId,
        status: 'PENDING_MANNEQUIN',
        source: 'catalog',
        creditsCharged: 25,
        queueStream: 'normal',
      })
      .returning();
    await cfg.db.insert(schema.jobInputs).values({
      jobId: step2Job.id,
      upperGarmentKey: null,
      params: { mannequinJobId: mannequinJob.id },
    });

    await promoteSareeStep2Jobs(cfg);
    await promoteSareeStep2Jobs(cfg);

    const [updatedJob] = await cfg.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Job.id));
    expect(updatedJob?.status).toBe('FAILED');
    const [after] = await cfg.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    // Refunded exactly once (25), not twice (50) — the credit_ledger unique
    // index on (job_id, reason) plus onConflictDoNothing makes the second
    // invocation's refund attempt a no-op.
    expect(after?.balance).toBe(25);
  });
});
