import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRefundDecisionEmail } from '../../src/lib/mailer.js';
import { adminApproveRefundRequest } from '../../src/modules/admin/refund-requests.routes.js';
import { signAccess } from '../../src/modules/auth/service.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Tests must never reach Resend: the auto-approve email is best-effort post-commit.
vi.mock('../../src/lib/mailer.js', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/mailer.js')>()),
  sendRefundDecisionEmail: vi.fn().mockResolvedValue(undefined),
}));
const emailMock = vi.mocked(sendRefundDecisionEmail);

const KEY = 'config:refund-auto-approve';
const AUTO_APPROVE_URL = '/admin/refund-requests/auto-approve';

describe('refund auto-approve', () => {
  let c: Containers;
  let app: TestApp;
  let superAdminAuth: Record<string, string>;
  let adminUserId: string;
  let seq = 0;
  const fakeRequest = { id: 'req-1', ip: '127.0.0.1', headers: {} } as unknown as FastifyRequest;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAdminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    const [u] = await app.db
      .select({ id: schema.adminUsers.userId })
      .from(schema.adminUsers)
      .limit(1);
    adminUserId = u.id;
  }, 60_000);
  beforeEach(async () => {
    emailMock.mockReset();
    emailMock.mockResolvedValue(undefined);
    await app.redis.del(KEY);
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerCustomer(label: string, balance = 3) {
    seq += 1;
    const email = `auto-refund-${label}-${seq}@x.com`;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { userId: user.id, email, auth: { authorization: `Bearer ${token}` } };
  }

  async function seedJob(
    userId: string,
    o: {
      creditsCharged?: number;
      downloadedAt?: Date | null;
      ledger?: { delta: number; reason: string } | null;
    } = {},
  ) {
    const creditsCharged = o.creditsCharged ?? 10;
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged })
      .returning();
    const ledger =
      o.ledger === undefined
        ? creditsCharged > 0
          ? { delta: -creditsCharged, reason: 'JOB_DISPATCH' }
          : null
        : o.ledger;
    if (ledger) {
      await app.db.insert(schema.creditLedger).values({ userId, jobId: job.id, ...ledger });
    }
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey: `outputs/${job.id}.png`,
      downloadedAt: o.downloadedAt ?? null,
    });
    return job.id as string;
  }

  // The customer route allows 60/min per IP — each caller gets its own test IP.
  const ipByAuth = new Map<string, string>();
  const ipFor = (auth: Record<string, string>) => {
    const key = auth.authorization;
    if (!ipByAuth.has(key)) ipByAuth.set(key, `198.51.100.${ipByAuth.size + 1}`);
    return ipByAuth.get(key) as string;
  };
  const post = (jobId: string, auth: Record<string, string>) =>
    app.inject({
      method: 'POST',
      remoteAddress: ipFor(auth),
      url: `/v1/jobs/${jobId}/refund-request`,
      headers: auth,
      payload: { reasonCode: 'POOR_QUALITY' },
    });

  const balance = async (userId: string) =>
    (
      await app.db
        .select({ b: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0].b;

  const requestByJob = async (jobId: string) =>
    (
      await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.jobId, jobId))
    )[0];

  const refundsForJob = (jobId: string) =>
    app.db
      .select()
      .from(schema.creditLedger)
      .where(
        and(
          eq(schema.creditLedger.jobId, jobId),
          eq(schema.creditLedger.reason, 'REFUND_USER_REQUEST'),
        ),
      );

  const auditsFor = (resourceId: string, action: string) =>
    app.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.resourceId, resourceId), eq(schema.auditLogs.action, action)));

  it('OFF by default (key absent): 201 PENDING, no credit, no ledger row, no email', async () => {
    const u = await registerCustomer('off');
    const jobId = await seedJob(u.userId);

    const getRes = await app.inject({
      method: 'GET',
      url: AUTO_APPROVE_URL,
      headers: superAdminAuth,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ enabled: false, dailyCap: 5 });

    const res = await post(jobId, u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ jobId, status: 'PENDING', autoApproved: false });

    const row = await requestByJob(jobId);
    expect(row).toMatchObject({ status: 'PENDING', autoApproved: false });
    expect(await balance(u.userId)).toBe(3);
    expect(await refundsForJob(jobId)).toHaveLength(0);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it.each([
    'not json',
    '42',
    '{"enabled":"yes","dailyCap":"lots"}',
  ])('malformed key %j behaves as OFF (fail-safe)', async (raw) => {
    await app.redis.set(KEY, raw);
    const u = await registerCustomer('malformed');
    const jobId = await seedJob(u.userId);

    const res = await post(jobId, u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'PENDING' });

    const row = await requestByJob(jobId);
    expect(row).toMatchObject({ status: 'PENDING', autoApproved: false });
    expect(await balance(u.userId)).toBe(3);
    expect(await refundsForJob(jobId)).toHaveLength(0);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('ON: 201 APPROVED at once — credited once, audited as AUTO_APPROVE, emailed once', async () => {
    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 5 }));
    const u = await registerCustomer('on');
    const jobId = await seedJob(u.userId);

    const res = await post(jobId, u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      jobId,
      status: 'APPROVED',
      credits: 10,
      autoApproved: true,
    });

    const row = await requestByJob(jobId);
    expect(row).toMatchObject({
      status: 'APPROVED',
      autoApproved: true,
      reviewedBy: null,
      adminNote: 'Auto-approved',
    });
    expect(row.reviewedAt).not.toBeNull();

    expect(await balance(u.userId)).toBe(13);
    const ledger = await refundsForJob(jobId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: 'REFUND_USER_REQUEST', delta: 10, userId: u.userId });

    const [auditRow] = await auditsFor(row.id, 'refund_request.auto_approve');
    expect(auditRow).toBeTruthy();
    expect(auditRow).toMatchObject({ actorUserId: u.userId, actorRole: 'AUTO_APPROVE' });
    expect(auditRow.after).toMatchObject({ status: 'APPROVED', credits: 10 });

    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(emailMock.mock.calls[0][2]).toBe(u.email);
    expect(emailMock.mock.calls[0][3]).toMatchObject({ approved: true, credits: 10 });

    const list = await app.inject({
      method: 'GET',
      url: '/admin/refund-requests?status=APPROVED&limit=100',
      headers: superAdminAuth,
    });
    expect(list.statusCode).toBe(200);
    const found = (
      list.json() as { requests: { id: string; autoApproved: boolean }[] }
    ).requests.find((r) => r.id === row.id);
    expect(found?.autoApproved).toBe(true);
  });

  it('cap boundary (dailyCap 2): 1st + 2nd auto-approve, 3rd stays PENDING with no credit', async () => {
    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 2 }));
    const u = await registerCustomer('cap');
    const [j1, j2, j3] = [
      await seedJob(u.userId),
      await seedJob(u.userId),
      await seedJob(u.userId),
    ];

    expect((await post(j1, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    expect((await post(j2, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    const third = await post(j3, u.auth);
    expect(third.statusCode).toBe(201);
    expect(third.json()).toMatchObject({ status: 'PENDING' });

    expect((await requestByJob(j3)).status).toBe('PENDING');
    expect(await refundsForJob(j3)).toHaveLength(0);
    expect(await balance(u.userId)).toBe(23);
    expect(emailMock).toHaveBeenCalledTimes(2);
  });

  it('manual approvals do not consume the auto cap', async () => {
    const u = await registerCustomer('cap-manual');
    const manual = await seedJob(u.userId);
    // File while OFF, then approve by hand via the admin function.
    expect((await post(manual, u.auth)).json()).toMatchObject({ status: 'PENDING' });
    const [pendingRow] = await app.db
      .select()
      .from(schema.refundRequests)
      .where(eq(schema.refundRequests.jobId, manual));
    await adminApproveRefundRequest(
      app,
      pendingRow.id,
      { userId: adminUserId, role: 'SUPER_ADMIN' },
      fakeRequest,
      {},
    );

    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 2 }));
    const j1 = await seedJob(u.userId);
    const j2 = await seedJob(u.userId);
    expect((await post(j1, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    expect((await post(j2, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    expect((await requestByJob(j1)).autoApproved).toBe(true);
    expect((await requestByJob(j2)).autoApproved).toBe(true);
    expect(await balance(u.userId)).toBe(33);
  });

  it('stale auto-approvals (>24h) do not consume the cap', async () => {
    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 1 }));
    const u = await registerCustomer('cap-stale');
    const j1 = await seedJob(u.userId);
    expect((await post(j1, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    await app.db
      .update(schema.refundRequests)
      .set({ reviewedAt: new Date(Date.now() - 25 * 3600 * 1000) })
      .where(eq(schema.refundRequests.jobId, j1));

    const j2 = await seedJob(u.userId);
    const res = await post(j2, u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'APPROVED' });
    expect(await balance(u.userId)).toBe(23);
  });

  it('ineligible jobs still 409 with the toggle ON (regenerated, downloaded, net-zero)', async () => {
    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 5 }));
    const u = await registerCustomer('ineligible');

    const regen = await seedJob(u.userId);
    await app.db
      .insert(schema.jobs)
      .values({ userId: u.userId, status: 'QUEUED', parentJobId: regen });
    const regenRes = await post(regen, u.auth);
    expect(regenRes.statusCode).toBe(409);
    expect(regenRes.json().error.code).toBe('ALREADY_REGENERATED');

    const dl = await seedJob(u.userId, { downloadedAt: new Date() });
    const dlRes = await post(dl, u.auth);
    expect(dlRes.statusCode).toBe(409);
    expect(dlRes.json().error.code).toBe('ALREADY_DOWNLOADED');

    const zero = await seedJob(u.userId, {
      creditsCharged: 10,
      ledger: { delta: 0, reason: 'UNLIMITED_PLAN_USAGE' },
    });
    const zeroRes = await post(zero, u.auth);
    expect(zeroRes.statusCode).toBe(409);
    expect(zeroRes.json().error.code).toBe('NOT_REFUNDABLE');

    for (const jobId of [regen, dl, zero]) {
      expect(await requestByJob(jobId)).toBeUndefined();
      expect(await refundsForJob(jobId)).toHaveLength(0);
    }
    expect(await balance(u.userId)).toBe(3);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('mid-path approval failure leaves 201 PENDING with the request row intact', async () => {
    // A prior REFUND_USER_REQUEST row for the job passes the create-path checks
    // (net is still -10) but makes applyRefundTx conflict inside the savepoint,
    // exercising the rollback-to-PENDING path deterministically.
    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 5 }));
    const u = await registerCustomer('savepoint');
    const jobId = await seedJob(u.userId);
    await app.db
      .insert(schema.creditLedger)
      .values({ userId: u.userId, jobId, delta: 0, reason: 'REFUND_USER_REQUEST' });

    const res = await post(jobId, u.auth);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'PENDING' });

    const row = await requestByJob(jobId);
    expect(row).toMatchObject({ status: 'PENDING', autoApproved: false });
    expect(await balance(u.userId)).toBe(3);
    // Only the seeded delta-0 row — the approval wrote nothing.
    const ledger = await refundsForJob(jobId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(0);
    expect(await auditsFor(row.id, 'refund_request.auto_approve')).toHaveLength(0);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('a PENDING filed while OFF is untouched by switching ON', async () => {
    const u = await registerCustomer('nosweep');
    const oldJob = await seedJob(u.userId);
    expect((await post(oldJob, u.auth)).json()).toMatchObject({ status: 'PENDING' });
    const before = await requestByJob(oldJob);

    await app.redis.set(KEY, JSON.stringify({ enabled: true, dailyCap: 5 }));

    const after = await requestByJob(oldJob);
    expect(after).toMatchObject({ id: before.id, status: 'PENDING', autoApproved: false });
    expect(await balance(u.userId)).toBe(3);
    expect(await refundsForJob(oldJob)).toHaveLength(0);

    // The toggle is live — only new filings auto-approve.
    const fresh = await seedJob(u.userId);
    expect((await post(fresh, u.auth)).json()).toMatchObject({ status: 'APPROVED' });
    expect((await requestByJob(oldJob)).status).toBe('PENDING');
  });

  describe('config endpoints', () => {
    it('unauthenticated GET/PATCH return 401', async () => {
      expect((await app.inject({ method: 'GET', url: AUTO_APPROVE_URL })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: AUTO_APPROVE_URL,
            payload: { enabled: true },
          })
        ).statusCode,
      ).toBe(401);
    });

    it('PATCH without credits.write returns 403 (SUPPORT has only credits.read)', async () => {
      const support = await adminAuthHeader(app, 'SUPPORT');
      const getRes = await app.inject({ method: 'GET', url: AUTO_APPROVE_URL, headers: support });
      expect(getRes.statusCode).toBe(200);
      const patchRes = await app.inject({
        method: 'PATCH',
        url: AUTO_APPROVE_URL,
        headers: support,
        payload: { enabled: true },
      });
      expect(patchRes.statusCode).toBe(403);
    });

    it('PATCH writes an audit row with before/after', async () => {
      const beforeRows = await app.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, 'refund_auto_approve.update'),
            eq(schema.auditLogs.resourceId, 'refund_auto_approve'),
          ),
        );
      const res = await app.inject({
        method: 'PATCH',
        url: AUTO_APPROVE_URL,
        headers: superAdminAuth,
        payload: { enabled: true, dailyCap: 2 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, dailyCap: 2 });

      const afterRows = await app.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, 'refund_auto_approve.update'),
            eq(schema.auditLogs.resourceId, 'refund_auto_approve'),
          ),
        );
      expect(afterRows).toHaveLength(beforeRows.length + 1);
      const row = afterRows.find((r) => !beforeRows.some((b) => b.id === r.id));
      expect(row).toMatchObject({
        resourceType: 'system_config',
        resourceId: 'refund_auto_approve',
        before: { enabled: false, dailyCap: 5 },
        after: { enabled: true, dailyCap: 2 },
      });
      const adminIds = (
        await app.db.select({ id: schema.adminUsers.userId }).from(schema.adminUsers)
      ).map((r) => r.id);
      expect(adminIds).toContain(row?.actorUserId);
    });

    it('PATCH merges: { enabled: true } preserves the stored cap', async () => {
      await app.redis.set(KEY, JSON.stringify({ enabled: false, dailyCap: 7 }));
      const res = await app.inject({
        method: 'PATCH',
        url: AUTO_APPROVE_URL,
        headers: superAdminAuth,
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, dailyCap: 7 });
      const getRes = await app.inject({
        method: 'GET',
        url: AUTO_APPROVE_URL,
        headers: superAdminAuth,
      });
      expect(getRes.json()).toEqual({ enabled: true, dailyCap: 7 });
    });

    it.each([{ dailyCap: 0 }, { dailyCap: 101 }])('PATCH %j returns 400', async (payload) => {
      const res = await app.inject({
        method: 'PATCH',
        url: AUTO_APPROVE_URL,
        headers: superAdminAuth,
        payload,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('404s for unknown job ids (sanity)', async () => {
    const u = await registerCustomer('sanity');
    expect((await post(randomUUID(), u.auth)).statusCode).toBe(404);
  });
});
