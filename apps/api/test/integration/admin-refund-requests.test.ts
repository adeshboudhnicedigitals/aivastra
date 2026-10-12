import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRefundDecisionEmail } from '../../src/lib/mailer.js';
import {
  adminApproveRefundRequest,
  adminRejectRefundRequest,
} from '../../src/modules/admin/refund-requests.routes.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Tests must never reach Resend: the route's email is best-effort and runs after commit.
vi.mock('../../src/lib/mailer.js', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/mailer.js')>()),
  sendRefundDecisionEmail: vi.fn().mockResolvedValue(undefined),
}));
const emailMock = vi.mocked(sendRefundDecisionEmail);

describe('admin refund requests', () => {
  let c: Containers;
  let app: TestApp;
  let adminUserId: string;
  let seq = 0;
  const fakeRequest = { id: 'req-1', ip: '127.0.0.1', headers: {} } as unknown as FastifyRequest;
  const actor = () => ({ userId: adminUserId, role: 'SUPER_ADMIN' });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    await adminAuthHeader(app, 'SUPER_ADMIN');
    const [u] = await app.db
      .select({ id: schema.adminUsers.userId })
      .from(schema.adminUsers)
      .limit(1);
    adminUserId = u.id;
  }, 60_000);
  beforeEach(() => {
    emailMock.mockReset();
    emailMock.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedRequest(o: { credits?: number; downloadedAt?: Date | null } = {}) {
    seq += 1;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `admin-refund-${seq}@x.com`, emailVerified: true })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 3 });
    const credits = o.credits ?? 10;
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'COMPLETED', creditsCharged: credits })
      .returning();
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey: `outputs/${job.id}.png`,
      downloadedAt: o.downloadedAt ?? null,
    });
    const [request] = await app.db
      .insert(schema.refundRequests)
      .values({ jobId: job.id, userId: user.id, credits, reasonCode: 'POOR_QUALITY' })
      .returning();
    return { request, userId: user.id, jobId: job.id as string };
  }

  const balance = async (userId: string) =>
    (
      await app.db
        .select({ b: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0].b;

  const audit = (id: string, action: string) =>
    app.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, action)));

  describe('approve', () => {
    it('credits the user once, marks APPROVED and writes an audit row', async () => {
      const { request, userId, jobId } = await seedRequest({ credits: 10 });
      const out = await adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'confirmed',
      });
      expect(out).toMatchObject({ status: 'APPROVED', credits: 10, userId });
      expect(await balance(userId)).toBe(13);
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row).toMatchObject({
        status: 'APPROVED',
        reviewedBy: adminUserId,
        adminNote: 'confirmed',
      });
      expect(row.reviewedAt).not.toBeNull();
      const ledger = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ reason: 'REFUND_USER_REQUEST', delta: 10 });
      expect(await audit(request.id, 'refund_request.approve')).toHaveLength(1);
    });

    it('credits exactly once under two concurrent approvals', async () => {
      const { request, userId } = await seedRequest({ credits: 10 });
      const results = await Promise.allSettled([
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await balance(userId)).toBe(13);
    });

    it('409s when the request is no longer PENDING', async () => {
      const { request, userId } = await seedRequest();
      await adminRejectRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'not a defect',
      });
      await expect(
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await balance(userId)).toBe(3);
    });

    it('409s when the image was downloaded in the meantime, without crediting', async () => {
      const { request, userId } = await seedRequest({ downloadedAt: new Date() });
      await expect(
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_DOWNLOADED' });
      expect(await balance(userId)).toBe(3);
    });

    it('404s for an unknown id', async () => {
      await expect(
        adminApproveRefundRequest(app, randomUUID(), actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rolls the credit and the status back if the audit insert fails', async () => {
      const { request, userId } = await seedRequest();
      // The audit table's NOT NULL actor columns reject an empty actor role.
      await expect(
        adminApproveRefundRequest(
          app,
          request.id,
          { userId: adminUserId, role: null as unknown as string },
          fakeRequest,
          {},
        ),
      ).rejects.toThrow(/actor_role|null value|not-null/i);
      expect(await balance(userId)).toBe(3);
      const [row] = await app.db
        .select({ status: schema.refundRequests.status })
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row.status).toBe('PENDING');
    });
  });

  describe('reject', () => {
    it('marks REJECTED with the note, writes an audit row and moves no credits', async () => {
      const { request, userId, jobId } = await seedRequest();
      const out = await adminRejectRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'Image looks fine',
      });
      expect(out.status).toBe('REJECTED');
      expect(await balance(userId)).toBe(3);
      const ledger = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      expect(ledger).toHaveLength(0);
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row).toMatchObject({ status: 'REJECTED', adminNote: 'Image looks fine' });
      expect(await audit(request.id, 'refund_request.reject')).toHaveLength(1);
    });
  });

  describe('HTTP', () => {
    it('requires authentication and the right permission', async () => {
      const { request } = await seedRequest();
      expect((await app.inject({ method: 'GET', url: '/admin/refund-requests' })).statusCode).toBe(
        401,
      );
      const noWrite = await adminAuthHeader(app, 'SUPPORT');
      const res = await app.inject({
        method: 'POST',
        url: `/admin/refund-requests/${request.id}/approve`,
        headers: noWrite,
        payload: {},
      });
      // SUPPORT has credits.read but not credits.write in the seeded role matrix; if the
      // seed ever grants it write, change this role to one that lacks it.
      expect(res.statusCode).toBe(403);
    });

    it('lists requests with the requester, filtered by status', async () => {
      const { request } = await seedRequest();
      const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
      const res = await app.inject({
        method: 'GET',
        url: '/admin/refund-requests?status=PENDING&limit=100',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const { requests } = res.json() as {
        requests: { id: string; userEmail: string; status: string; downloadedAt: string | null }[];
      };
      const found = requests.find((r) => r.id === request.id);
      expect(found).toBeTruthy();
      expect(found?.userEmail).toContain('@x.com');
      expect(requests.every((r) => r.status === 'PENDING')).toBe(true);
    });

    const post = async (id: string, action: 'approve' | 'reject', payload: object) =>
      app.inject({
        method: 'POST',
        url: `/admin/refund-requests/${id}/${action}`,
        headers: await adminAuthHeader(app, 'SUPER_ADMIN'),
        payload,
      });
    const status = async (id: string) =>
      (
        await app.db
          .select({ s: schema.refundRequests.status })
          .from(schema.refundRequests)
          .where(eq(schema.refundRequests.id, id))
      )[0].s;

    it('approves over HTTP and emails the requester', async () => {
      const { request, userId } = await seedRequest({ credits: 4 });
      const res = await post(request.id, 'approve', {});
      expect(res.statusCode).toBe(200);
      expect(await balance(userId)).toBe(7);
      expect(emailMock).toHaveBeenCalledTimes(1);
      expect(emailMock.mock.calls[0][2]).toBe(`admin-refund-${seq}@x.com`);
      expect(emailMock.mock.calls[0][3]).toMatchObject({ approved: true, credits: 4 });
    });

    it('still approves when the email send fails', async () => {
      const { request, userId } = await seedRequest({ credits: 4 });
      emailMock.mockRejectedValueOnce(new Error('resend down'));
      const res = await post(request.id, 'approve', {});
      expect(res.statusCode).toBe(200);
      expect(emailMock).toHaveBeenCalledTimes(1);
      expect(await balance(userId)).toBe(7);
      expect(await status(request.id)).toBe('APPROVED');
    });

    it('rejects over HTTP: needs a real note, moves no credits, emails the decline', async () => {
      const { request, userId } = await seedRequest({ credits: 4 });
      expect((await post(request.id, 'reject', {})).statusCode).toBe(400);
      expect((await post(request.id, 'reject', { adminNote: 'no' })).statusCode).toBe(400);
      expect(await status(request.id)).toBe('PENDING');
      expect(emailMock).not.toHaveBeenCalled();

      const res = await post(request.id, 'reject', { adminNote: 'Image looks fine' });
      expect(res.statusCode).toBe(200);
      expect(await status(request.id)).toBe('REJECTED');
      expect(await balance(userId)).toBe(3);
      expect(emailMock).toHaveBeenCalledTimes(1);
      expect(emailMock.mock.calls[0][3]).toMatchObject({ approved: false });
    });
  });
});
