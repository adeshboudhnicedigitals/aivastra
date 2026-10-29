import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let c: Containers;
let app: TestApp;
let auth: Record<string, string>;
beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  auth = await adminAuthHeader(app, 'SUPER_ADMIN');
}, 90_000);
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

it.each([
  ['QUEUED', JOB_SOURCE.CATALOG, false, 'CANCELLED', 6],
  ['GENERATING', JOB_SOURCE.CATALOG, true, 'GENERATING', 5],
  ['PREPROCESSING', JOB_SOURCE.CATALOG, true, 'PREPROCESSING', 5],
  ['GENERATING', JOB_SOURCE.TRYON, false, 'CANCELLED', 6],
  ['COMPLETED', JOB_SOURCE.CATALOG, false, 'COMPLETED', 5],
  ['CANCELLED', JOB_SOURCE.CATALOG, false, 'CANCELLED', 5],
] as const)('admin cancel %s/%s preserves pending/refund contract', async (status, source, pending, expectedStatus, balance) => {
  const [user] = await app.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@test.com` })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 5 });
  const [job] = await app.db
    .insert(schema.jobs)
    .values({ userId: user.id, source, status, creditsCharged: 1 })
    .returning();
  const before = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  const response = await app.inject({
    method: 'POST',
    url: `/admin/jobs/${job.id}/cancel`,
    headers: auth,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(pending ? { ok: true, pending: true } : { ok: true });
  const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  expect(after.status).toBe(expectedStatus);
  if (pending) expect(after).toEqual(before[0]);
  expect(await app.redis.get(`job:cancel:${job.id}`)).toBe(pending ? '1' : null);
  if (pending) expect(await app.redis.ttl(`job:cancel:${job.id}`)).toBeGreaterThan(590);
  const [credits] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, user.id));
  expect(credits.balance).toBe(balance);
  const ledger = await app.db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.jobId, job.id));
  expect(ledger).toHaveLength(balance === 6 ? 1 : 0);
  if (balance === 6) expect(ledger[0].reason).toBe('REFUND_ADMIN_CANCEL');
  await app.redis.del(`job:cancel:${job.id}`);
});

it('admin cancellation cannot refund again after dispatcher cancellation already paid', async () => {
  const [user] = await app.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@test.com` })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 6 });
  const [job] = await app.db
    .insert(schema.jobs)
    .values({ userId: user.id, source: JOB_SOURCE.TRYON, status: 'GENERATING', creditsCharged: 1 })
    .returning();
  await app.db
    .insert(schema.creditLedger)
    .values({ userId: user.id, jobId: job.id, delta: 1, reason: 'JOB_CANCEL_REFUND' });
  const response = await app.inject({
    method: 'POST',
    url: `/admin/jobs/${job.id}/cancel`,
    headers: auth,
  });
  expect(response.statusCode).toBe(200);
  const [credits] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, user.id));
  expect(credits.balance).toBe(6);
  expect(
    await app.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, job.id)),
  ).toHaveLength(1);
});

// The route reads the status outside any transaction, so a completion can commit between
// that read and the cancel's write. The completion is held uncommitted on the job row; the
// cancel reads the old status, then blocks on its conditional UPDATE, then must find a job
// that is no longer cancellable. Both waits are explicit database signals, not sleeps.
async function waitForBlockedWrite() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await app.db.execute(
      sql`select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%update "jobs"%'`,
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('cancel never reached its blocked status write');
}

it('admin cancel racing a completion neither cancels nor refunds the completed job', async () => {
  const [user] = await app.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@test.com` })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 5 });
  const [job] = await app.db
    .insert(schema.jobs)
    .values({ userId: user.id, source: JOB_SOURCE.TRYON, status: 'GENERATING', creditsCharged: 1 })
    .returning();
  let release: () => void = () => {};
  let locked: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const completion = app.db.transaction(async (tx) => {
    await tx.update(schema.jobs).set({ status: 'COMPLETED' }).where(eq(schema.jobs.id, job.id));
    await tx
      .insert(schema.jobOutputs)
      .values({ jobId: job.id, resultKey: 'private/race.png', assetKind: 'ORIGINAL' });
    locked();
    await held;
  });
  await lockTaken;
  const cancelling = app.inject({
    method: 'POST',
    url: `/admin/jobs/${job.id}/cancel`,
    headers: auth,
  });
  await waitForBlockedWrite();
  release();
  await completion;
  expect((await cancelling).statusCode).toBe(200);

  const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  expect(after.status).toBe('COMPLETED');
  expect(
    await app.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, job.id)),
  ).toHaveLength(1);
  expect(
    await app.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, job.id)),
  ).toEqual([]);
  const [credits] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, user.id));
  expect(credits.balance).toBe(5);
});

it('admin cancel of a FAILED job leaves it FAILED and refunds nothing more', async () => {
  const [user] = await app.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@test.com` })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 6 });
  const [job] = await app.db
    .insert(schema.jobs)
    .values({ userId: user.id, source: JOB_SOURCE.TRYON, status: 'FAILED', creditsCharged: 1 })
    .returning();
  // The dispatcher already refunded this failure.
  await app.db
    .insert(schema.creditLedger)
    .values({ userId: user.id, jobId: job.id, delta: 1, reason: 'JOB_FAIL_REFUND' });
  const response = await app.inject({
    method: 'POST',
    url: `/admin/jobs/${job.id}/cancel`,
    headers: auth,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  expect(after.status).toBe('FAILED');
  const ledger = await app.db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.jobId, job.id));
  expect(ledger.map((row) => row.reason)).toEqual(['JOB_FAIL_REFUND']);
  const [credits] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, user.id));
  expect(credits.balance).toBe(6);
});
