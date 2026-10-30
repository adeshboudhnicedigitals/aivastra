import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireComfyJob,
  assertStorageWriteLease,
  OwnershipLostError,
  takeoverComfyJob,
} from '../../src/job/ownership.js';
import { finalizeOutput } from '../../src/workflow/finalize.js';
import { adoptionFixture } from '../helpers/adoption-fixture.js';
import { PATH_FIXTURE_KEY, seedPaidJob } from '../helpers/paid-jobs.js';

// An owner that lost (or is about to lose) its lease must not write to storage: a replacement
// may already be running the job. Inputs are named per attempt so a late upload from an older
// attempt cannot overwrite the file a replacement prompt reads.
describe('storage writes are lease-checked and attempt-scoped', () => {
  let f: Awaited<ReturnType<typeof adoptionFixture>>;
  const log = createLogger('storage-lease-test');
  beforeAll(async () => {
    f = await adoptionFixture('stlease');
    await f.env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);
  beforeEach(() => f.reset());
  afterAll(() => f.close());

  const png = () =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
      .png()
      .toBuffer();

  const spyStorage = () => {
    const puts: string[] = [];
    return {
      puts,
      storage: {
        ...f.env.storage,
        putObject: async (key: string) => {
          puts.push(key);
        },
      } as unknown as typeof f.env.storage,
    };
  };
  const finalizeWith = async (
    owner: Parameters<typeof finalizeOutput>[0]['owner'],
    jobId: string,
    userId: string,
    storage: typeof f.env.storage,
  ) =>
    finalizeOutput({
      owner,
      imageBytes: await png(),
      jobId,
      userId,
      jobWatermark: false,
      db: f.env.db,
      pub: f.redis,
      storage,
      jobLog: log,
    });

  it('lease-check-before-put: a superseded owner writes nothing; the live one writes', async () => {
    const { user, job } = await seedPaidJob(f.env, 'regular');
    const first = await acquireComfyJob(f.env.db, job.id, randomUUID(), log);
    if (first.kind !== 'Acquired') throw new Error('not acquired');
    const spy = spyStorage();

    // Live and healthy: the write goes through.
    await finalizeWith(first.owner, job.id, user.id, spy.storage);
    expect(spy.puts.length).toBeGreaterThan(0);
    spy.puts.length = 0;

    // A replacement takes a new generation after the lease lapsed (a second, unfinished job).
    const other = await seedPaidJob(f.env, 'regular');
    const stale = await acquireComfyJob(f.env.db, other.job.id, randomUUID(), log);
    if (stale.kind !== 'Acquired') throw new Error('not acquired');
    await f.expireLease(other.job.id);
    const second = await takeoverComfyJob(f.env.db, other.job.id, randomUUID());
    expect(second.kind).toBe('Acquired');
    await expect(
      finalizeWith(stale.owner, other.job.id, other.user.id, spy.storage),
    ).rejects.toBeInstanceOf(OwnershipLostError);
    expect(spy.puts).toEqual([]);
  });

  it('a lease with too little time left is refused, and a database error means no write', async () => {
    const { job } = await seedPaidJob(f.env, 'regular');
    const got = await acquireComfyJob(f.env.db, job.id, randomUUID(), log);
    if (got.kind !== 'Acquired') throw new Error('not acquired');
    await f.env.db
      .update(schema.dispatcherJobControl)
      .set({ leaseUntil: sql`clock_timestamp() + interval '2 seconds'` })
      .where(eq(schema.dispatcherJobControl.jobId, job.id));
    await expect(assertStorageWriteLease(f.env.db, got.owner, 'test')).rejects.toBeInstanceOf(
      OwnershipLostError,
    );
    const broken = {
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => Promise.reject(new Error('db down')) }) }),
      }),
    } as never;
    await expect(assertStorageWriteLease(broken, got.owner, 'test')).rejects.toThrow('db down');
  });

  it('late-input-upload-isolated: every uploaded input name carries the attempt id', async () => {
    f.comfy.setOptions({
      outputs: { '4': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } },
    });
    const { user, job } = await seedPaidJob(f.env, 'regular');
    await f.replacement(job.id, user.id);
    const [attempt] = await f.env.db
      .select()
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.jobId, job.id));
    const names = f.comfy.uploadedFilenames().filter((n) => n.includes(job.id));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toContain(`_${attempt?.id}`);
  }, 60_000);
});
