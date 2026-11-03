import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/admin/fleet/jobs/:id/{cancel,retry}', () => {
  let c: Containers;
  let app: TestApp;
  let sup: Record<string, string>;
  let adm: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    sup = await adminAuthHeader(app, 'SUPER_ADMIN');
    adm = await adminAuthHeader(app, 'ADMIN');
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@test.com` })
      .returning();
    userId = u?.id as string;
    await app.db.insert(schema.userCredits).values({ userId, balance: 10 });
  }, 90000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const makeJob = async (over: Record<string, unknown> = {}) => {
    const [j] = await app.db
      .insert(schema.jobs)
      .values({ userId, source: 'tryon', status: 'QUEUED', creditsCharged: 1, ...over })
      .returning();
    return j?.id as string;
  };
  const act = (
    kind: 'cancel' | 'retry',
    id: string,
    payload: unknown = { reason: 'operator decision' },
    headers = sup,
  ) =>
    app.inject({
      method: 'POST',
      url: `/admin/fleet/jobs/${id}/${kind}`,
      headers,
      payload: payload as object,
    });
  const row = async (id: string) =>
    (await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
  const balance = async () =>
    (await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId)))[0]
      ?.balance;
  const audits = (action: string, id: string) =>
    app.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.resourceId, id)));

  it('needs fleet.operate and a reason', async () => {
    const id = await makeJob();
    expect((await act('cancel', id, undefined, adm)).statusCode).toBe(403);
    expect((await act('cancel', id, { reason: '' })).statusCode).toBe(400);
    expect((await act('cancel', id, { reason: 'no login' }, {})).statusCode).toBe(401);
    expect((await row(id))?.status).toBe('QUEUED');
  });

  it('cancels a queued job, refunds once, audits, and a second cancel is refused', async () => {
    const id = await makeJob();
    const before = (await balance()) as number;
    const res = await act('cancel', id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, jobId: id, status: 'CANCELLED', refunded: true });
    expect((await row(id))?.status).toBe('CANCELLED');
    expect(await balance()).toBe(before + 1);
    const ledger = await app.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.reason).toBe('REFUND_ADMIN_CANCEL');
    const a = await audits('fleet.job.cancel', id);
    expect(a).toHaveLength(1);
    expect(JSON.stringify(a[0]?.after)).toContain('operator decision');

    const again = await act('cancel', id);
    expect(again.statusCode).toBe(409);
    expect(await balance()).toBe(before + 1);
    expect(await audits('fleet.job.cancel', id)).toHaveLength(1);
  });

  it.each([
    'GENERATING',
    'PREPROCESSING',
    'COMPLETED',
    'FAILED',
  ])('refuses to cancel a %s job and changes nothing', async (status) => {
    const id = await makeJob({ status });
    const before = await balance();
    const res = await act('cancel', id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/Only a queued job/);
    expect((await row(id))?.status).toBe(status);
    expect(await balance()).toBe(before);
    expect(await audits('fleet.job.cancel', id)).toHaveLength(0);
  });

  it('leaves store-billed jobs to the admin panel', async () => {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `fleet-${crypto.randomUUID()}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning({ id: schema.shopifyStores.id });
    const id = await makeJob({ userId: null, shopifyStoreId: store?.id });
    const res = await act('cancel', id);
    expect(res.statusCode).toBe(409);
    expect((await row(id))?.status).toBe('QUEUED');
  });

  it('404s on an unknown job', async () => {
    const res = await act('cancel', '00000000-0000-4000-8000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('retries a failed job: back to QUEUED, one stream entry, audited, not charged again', async () => {
    const id = await makeJob({
      status: 'FAILED',
      errorCode: 'COMFY_ERROR',
      attempts: 2,
      queueStream: 'normal',
    });
    const before = await balance();
    const lenBefore = await app.redis.xlen('jobs:normal');
    const res = await act('retry', id, { reason: 'worker fixed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: id, status: 'QUEUED', refunded: false });
    const j = await row(id);
    expect(j).toMatchObject({ status: 'QUEUED', errorCode: null, attempts: 0 });
    expect(await app.redis.xlen('jobs:normal')).toBe(lenBefore + 1);
    expect(await balance()).toBe(before);
    const a = await audits('fleet.job.retry', id);
    expect(a).toHaveLength(1);
    expect(JSON.stringify(a[0]?.after)).toContain('worker fixed');

    // Now QUEUED: a double click cannot add a second stream entry.
    const again = await act('retry', id);
    expect(again.statusCode).toBe(409);
    expect(await app.redis.xlen('jobs:normal')).toBe(lenBefore + 1);
  });

  it('reports when the failure had already been refunded', async () => {
    const id = await makeJob({ status: 'FAILED', queueStream: 'normal' });
    await app.db.insert(schema.creditLedger).values({
      userId,
      delta: 1,
      reason: 'JOB_FAIL_REFUND',
      jobId: id,
    } as never);
    const res = await act('retry', id);
    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(true);
    expect(JSON.stringify((await audits('fleet.job.retry', id))[0]?.after)).toContain(
      '"previouslyRefunded":true',
    );
  });

  it.each([
    ['QUEUED', 'tryon'],
    ['GENERATING', 'tryon'],
    ['COMPLETED', 'tryon'],
    ['FAILED', 'comparison'],
  ])('refuses to retry %s/%s', async (status, source) => {
    const id = await makeJob({ status, source });
    const res = await act('retry', id);
    expect(res.statusCode).toBe(409);
    expect((await row(id))?.status).toBe(status);
    expect(await audits('fleet.job.retry', id)).toHaveLength(0);
  });
});
