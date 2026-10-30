import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireComfyJob,
  assertOwnerInTransaction,
  LEASE_MS,
  OwnershipLostError,
  renewLeases,
  takeoverComfyJob,
  trackOwnedJob,
  yieldComfyJob,
} from '../../src/job/ownership.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

describe('paid-Comfy job ownership', () => {
  let env: TestEnv;
  const log = createLogger('ownership-test');
  const sessionA = randomUUID();
  const sessionB = randomUUID();

  beforeAll(async () => {
    env = await setupTestEnv();
  }, 60_000);
  afterAll(async () => {
    await env?.cleanup();
  });

  async function job(status = 'QUEUED') {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `own-${randomUUID()}@test.invalid`, passwordHash: 'x', tier: 'free' })
      .returning();
    const [row] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status, creditsCharged: 1 } as typeof schema.jobs.$inferInsert)
      .returning();
    if (!row) throw new Error('fixture job');
    return row.id;
  }
  const control = async (jobId: string) =>
    (
      await env.db.execute(
        sql`select owner_session, generation::int as generation, owner_retired, lease_until > clock_timestamp() as live from dispatcher_job_control where job_id = ${jobId}`,
      )
    )[0];
  const statusOf = async (jobId: string) =>
    (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]?.status;
  async function expireLease(jobId: string) {
    await env.db.execute(
      sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second' where job_id = ${jobId}`,
    );
  }

  describe('acquireComfyJob', () => {
    it('admits one QUEUED job: generation 1, PREPROCESSING and its event in one step', async () => {
      const id = await job();
      const result = await acquireComfyJob(env.db, id, sessionA, log);
      expect(result).toMatchObject({
        kind: 'Acquired',
        owner: { session: sessionA, generation: 1 },
      });
      expect(await statusOf(id)).toBe('PREPROCESSING');
      expect(await control(id)).toMatchObject({
        owner_session: sessionA,
        generation: 1,
        live: true,
      });
      const events = await env.db.execute(
        sql`select 1 from job_events where job_id = ${id} and event_type = 'PREPROCESSING'`,
      );
      expect(events).toHaveLength(1);
    });

    it('lets exactly one of many concurrent deliveries win', async () => {
      const id = await job();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => acquireComfyJob(env.db, id, randomUUID(), log)),
      );
      expect(results.filter((r) => r.kind === 'Acquired')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'LiveOwner')).toHaveLength(5);
      expect((await control(id))?.generation).toBe(1);
    });

    it('reports LiveOwner while a QUEUED job (no-worker sleep) still holds its lease', async () => {
      const id = await job();
      await acquireComfyJob(env.db, id, sessionA, log);
      await env.db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, id));
      expect((await acquireComfyJob(env.db, id, sessionB, log)).kind).toBe('LiveOwner');
      expect(await statusOf(id)).toBe('QUEUED');
    });

    it('reports Terminal for COMPLETED, FAILED and CANCELLED and touches nothing', async () => {
      for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
        const id = await job(status);
        expect(await acquireComfyJob(env.db, id, sessionA, log)).toMatchObject({
          kind: 'Terminal',
          status,
        });
        expect(await control(id)).toBeUndefined();
      }
    });

    it('reports Recoverable for an in-flight job with no live owner, ownerless or expired', async () => {
      const ownerless = await job('GENERATING');
      expect((await acquireComfyJob(env.db, ownerless, sessionA, log)).kind).toBe('Recoverable');
      const expired = await job();
      await acquireComfyJob(env.db, expired, sessionA, log);
      await expireLease(expired);
      expect((await acquireComfyJob(env.db, expired, sessionB, log)).kind).toBe('Recoverable');
      expect(await statusOf(expired)).toBe('PREPROCESSING');
    });

    it('re-admits a QUEUED job whose lease expired or was retired with generation + 1', async () => {
      const id = await job();
      await acquireComfyJob(env.db, id, sessionA, log);
      await env.db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, id));
      await expireLease(id);
      expect(await acquireComfyJob(env.db, id, sessionB, log)).toMatchObject({
        kind: 'Acquired',
        owner: { session: sessionB, generation: 2 },
      });
    });
  });

  describe('takeoverComfyJob', () => {
    it('gives a recovering process a fresh generation without changing status', async () => {
      const id = await job('UPLOADING');
      const result = await takeoverComfyJob(env.db, id, sessionB);
      expect(result).toMatchObject({ kind: 'Acquired', owner: { generation: 1 } });
      expect(await statusOf(id)).toBe('UPLOADING');
    });

    it('refuses a live owner', async () => {
      const id = await job();
      await acquireComfyJob(env.db, id, sessionA, log);
      expect((await takeoverComfyJob(env.db, id, sessionB)).kind).toBe('LiveOwner');
    });
  });

  describe('assertOwnerInTransaction', () => {
    async function owned() {
      const id = await job();
      const result = await acquireComfyJob(env.db, id, sessionA, log);
      if (result.kind !== 'Acquired') throw new Error('fixture acquire');
      return result.owner;
    }
    const check = (owner: Parameters<typeof assertOwnerInTransaction>[1]) =>
      env.db.transaction((tx) => assertOwnerInTransaction(tx, owner, 'test'));

    it('passes for the live current owner', async () => {
      await expect(check(await owned())).resolves.toBe('PREPROCESSING');
    });

    it('rejects a wrong session, wrong generation, expired and retired lease', async () => {
      const owner = await owned();
      await expect(check({ ...owner, session: sessionB })).rejects.toBeInstanceOf(
        OwnershipLostError,
      );
      await expect(check({ ...owner, generation: owner.generation + 1 })).rejects.toBeInstanceOf(
        OwnershipLostError,
      );
      await env.db.execute(
        sql`update dispatcher_job_control set owner_retired = true where job_id = ${owner.jobId}`,
      );
      await expect(check(owner)).rejects.toBeInstanceOf(OwnershipLostError);
      const second = await owned();
      await expireLease(second.jobId);
      await expect(check(second)).rejects.toBeInstanceOf(OwnershipLostError);
    });

    it('does not treat an API-cancelled job as lost ownership while the lease is still ours', async () => {
      const owner = await owned();
      await env.db
        .update(schema.jobs)
        .set({ status: 'CANCELLED' })
        .where(eq(schema.jobs.id, owner.jobId));
      await expect(check(owner)).resolves.toBe('CANCELLED');
    });

    it('rejects an owner that was superseded by a takeover', async () => {
      const owner = await owned();
      await expireLease(owner.jobId);
      await takeoverComfyJob(env.db, owner.jobId, sessionB);
      await expect(check(owner)).rejects.toBeInstanceOf(OwnershipLostError);
    });
  });

  describe('renewLeases', () => {
    it('extends a live lease', async () => {
      const id = await job();
      const acquired = await acquireComfyJob(env.db, id, sessionA, log);
      if (acquired.kind !== 'Acquired') throw new Error('fixture acquire');
      trackOwnedJob(acquired.owner);
      await env.db.execute(
        sql`update dispatcher_job_control set lease_until = clock_timestamp() + interval '2 seconds' where job_id = ${id}`,
      );
      expect(await renewLeases(env.db, sessionA)).toBeGreaterThanOrEqual(1);
      const [row] = await env.db.execute(
        sql`select extract(epoch from (lease_until - clock_timestamp())) * 1000 as ms from dispatcher_job_control where job_id = ${id}`,
      );
      expect(Number(row?.ms)).toBeGreaterThan(LEASE_MS - 5_000);
    });

    it('never revives an expired or retired lease, nor another session', async () => {
      // Both are tracked as in flight, so only the SQL guards stand between them and a revival.
      const track = async (id: string, session: string) => {
        const a = await acquireComfyJob(env.db, id, session, log);
        if (a.kind !== 'Acquired') throw new Error('fixture acquire');
        trackOwnedJob(a.owner);
      };
      const expired = await job();
      await track(expired, sessionB);
      await expireLease(expired);
      const retired = await job();
      await track(retired, sessionB);
      await env.db.execute(
        sql`update dispatcher_job_control set owner_retired = true, lease_until = clock_timestamp() + interval '2 seconds' where job_id = ${retired}`,
      );
      const before = await env.db.execute(
        sql`select lease_until from dispatcher_job_control where job_id = ${retired}`,
      );
      await renewLeases(env.db, sessionB);
      const after = await env.db.execute(
        sql`select lease_until from dispatcher_job_control where job_id = ${retired}`,
      );
      expect((await control(expired))?.live).toBe(false);
      // Renewal must not have extended the retired lease at all.
      expect(after[0]?.lease_until).toEqual(before[0]?.lease_until);
      const mine = await job();
      await track(mine, sessionA);
      await expireLease(mine);
      await renewLeases(env.db, sessionB);
      expect((await control(mine))?.live).toBe(false);
    });
  });

  describe('yieldComfyJob', () => {
    it('requeues and retires in one fenced step so a replacement acquires at once', async () => {
      const id = await job();
      const first = await acquireComfyJob(env.db, id, sessionA, log);
      if (first.kind !== 'Acquired') throw new Error('fixture acquire');
      expect(await yieldComfyJob(env.db, first.owner, {}, log)).toBe('yielded');
      expect(await statusOf(id)).toBe('QUEUED');
      expect((await control(id))?.owner_retired).toBe(true);
      expect(await acquireComfyJob(env.db, id, sessionB, log)).toMatchObject({
        kind: 'Acquired',
        owner: { generation: 2 },
      });
    });

    it('returns lost and changes nothing for a stale owner', async () => {
      const id = await job();
      const first = await acquireComfyJob(env.db, id, sessionA, log);
      if (first.kind !== 'Acquired') throw new Error('fixture acquire');
      await expireLease(id);
      await takeoverComfyJob(env.db, id, sessionB);
      expect(await yieldComfyJob(env.db, first.owner, {}, log)).toBe('lost');
      expect(await statusOf(id)).toBe('PREPROCESSING');
      expect((await control(id))?.owner_retired).toBe(false);
    });
  });
});
