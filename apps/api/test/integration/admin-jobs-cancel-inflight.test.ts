import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { eq } from 'drizzle-orm';
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
