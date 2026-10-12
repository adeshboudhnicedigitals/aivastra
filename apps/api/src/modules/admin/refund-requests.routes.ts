import { schema } from '@aivastra/db';
import { creditsRefundedTotal } from '@aivastra/observability';
import { keys } from '@aivastra/storage';
import { AdminApproveRefundBody, AdminRejectRefundBody, RefundStatus } from '@aivastra/types';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendRefundDecisionEmail } from '../../lib/mailer.js';
import { applyRefundTx } from '../credits/ledger.js';
import { ledgerNetForJob } from '../jobs/refund-requests.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const R = schema.refundRequests;

const ListQuery = z.object({
  status: RefundStatus.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type Actor = { userId: string; role: string };

/**
 * Approve = refund the snapshotted credits, flip the status and write the audit row
 * in ONE transaction. The ledger's (job_id, reason) unique index plus the row lock make
 * a double click or two admins at once credit exactly once. Exported so tests can drive
 * it without HTTP; the route adds the post-commit email.
 */
export async function adminApproveRefundRequest(
  app: FastifyInstance,
  id: string,
  actor: Actor,
  request: FastifyRequest,
  body: AdminApproveRefundBody,
) {
  const result = await app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(R).where(eq(R.id, id)).for('update');
    if (!row) throw new AppError('NOT_FOUND', 404, 'refund request not found');
    if (row.status !== 'PENDING') {
      throw new AppError('CONFLICT', 409, `request is already ${row.status}`);
    }

    // The customer cannot download while the request is open, so this only trips when a
    // download landed in the instant before the request was created. They have the image
    // — the admin should reject, not refund.
    const [output] = await tx
      .select({ downloadedAt: schema.jobOutputs.downloadedAt })
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, row.jobId));
    if (output?.downloadedAt) {
      throw new AppError(
        'ALREADY_DOWNLOADED',
        409,
        'the customer downloaded this image — reject the request instead',
      );
    }

    // Re-verify against the job and the ledger, under the job lock that admin-cancel
    // refunds also take: between filing and now the job may have been cancelled, or
    // another path (REFUND_ADMIN_CANCEL, JOB_FAIL_REFUND, JOB_CANCEL_REFUND) may have
    // already returned these credits. The (job_id, reason) unique index only stops a
    // second REFUND_USER_REQUEST, not a refund under a different reason.
    const [job] = await tx
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, row.jobId))
      .for('update');
    if (job?.status !== 'COMPLETED') {
      throw new AppError('NOT_REFUNDABLE', 409, 'this job is no longer completed');
    }
    const net = await ledgerNetForJob(tx, row.jobId, row.userId);
    if (-net < row.credits) {
      throw new AppError(
        'NOT_REFUNDABLE',
        409,
        'credits for this job were already refunded or were never charged',
      );
    }

    const adminNote = body.adminNote || null;
    const applied = await applyRefundTx(
      tx,
      row.userId,
      row.credits,
      row.jobId,
      'REFUND_USER_REQUEST',
    );
    if (!applied) throw new AppError('CONFLICT', 409, 'credits for this job were already refunded');

    const now = new Date();
    await tx
      .update(R)
      .set({
        status: 'APPROVED',
        adminNote,
        reviewedBy: actor.userId,
        reviewedAt: now,
      })
      .where(and(eq(R.id, id), eq(R.status, 'PENDING')));

    await recordAudit(tx, {
      actor,
      action: 'refund_request.approve',
      resourceType: 'refund_requests',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', credits: row.credits, adminNote },
      request,
    });
    return { id, status: 'APPROVED' as const, credits: row.credits, userId: row.userId };
  });
  creditsRefundedTotal.inc(result.credits);
  return result;
}

export async function adminRejectRefundRequest(
  app: FastifyInstance,
  id: string,
  actor: Actor,
  request: FastifyRequest,
  body: AdminRejectRefundBody,
) {
  return app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(R).where(eq(R.id, id)).for('update');
    if (!row) throw new AppError('NOT_FOUND', 404, 'refund request not found');
    if (row.status !== 'PENDING') {
      throw new AppError('CONFLICT', 409, `request is already ${row.status}`);
    }
    await tx
      .update(R)
      .set({
        status: 'REJECTED',
        adminNote: body.adminNote,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      })
      .where(and(eq(R.id, id), eq(R.status, 'PENDING')));

    await recordAudit(tx, {
      actor,
      action: 'refund_request.reject',
      resourceType: 'refund_requests',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', adminNote: body.adminNote },
      request,
    });
    return { id, status: 'REJECTED' as const, credits: row.credits, userId: row.userId };
  });
}

/** Best-effort: a failed email must never undo a committed decision. */
async function notifyUser(
  app: FastifyInstance,
  userId: string,
  decision: { approved: boolean; credits: number; adminNote: string | null },
) {
  try {
    const [user] = await app.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user?.email) return;
    await sendRefundDecisionEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, user.email, decision);
  } catch (err) {
    app.log.error({ err, userId }, 'Failed to send refund decision email');
  }
}

export async function adminRefundRequestsRoutes(app: FastifyInstance) {
  const RO = requirePermission('credits.read');
  const RW = requirePermission('credits.write');
  const idParams = z.object({ id: z.string().uuid() });

  app.get(
    '/admin/refund-requests',
    { preHandler: RO, schema: { querystring: ListQuery } },
    async (req) => {
      const q = req.query as z.infer<typeof ListQuery>;
      const conds = [];
      if (q.status) conds.push(eq(R.status, q.status));
      if (q.cursor) conds.push(lt(R.createdAt, new Date(q.cursor)));

      const rows = await app.db
        .select({
          id: R.id,
          jobId: R.jobId,
          userId: R.userId,
          userEmail: schema.users.email,
          userName: schema.users.displayName,
          credits: R.credits,
          reasonCode: R.reasonCode,
          note: R.note,
          status: R.status,
          adminNote: R.adminNote,
          reviewedAt: R.reviewedAt,
          createdAt: R.createdAt,
          resultKey: schema.jobOutputs.resultKey,
          thumbnailKey: schema.jobOutputs.thumbnailKey,
          downloadedAt: schema.jobOutputs.downloadedAt,
        })
        .from(R)
        .innerJoin(schema.users, eq(schema.users.id, R.userId))
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, R.jobId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(R.createdAt))
        .limit(q.limit);

      const requests = await Promise.all(
        rows.map(async ({ resultKey, thumbnailKey, ...r }) => {
          const full = resultKey ?? keys.output(r.jobId);
          return {
            ...r,
            imageUrl: (await app.storage.presignGet(full, 3600)).url,
            previewUrl: (await app.storage.presignGet(thumbnailKey ?? full, 3600)).url,
          };
        }),
      );
      const nextCursor =
        rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null;
      return { requests, nextCursor };
    },
  );

  app.post(
    '/admin/refund-requests/:id/approve',
    { preHandler: RW, schema: { params: idParams, body: AdminApproveRefundBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as AdminApproveRefundBody;
      const out = await adminApproveRefundRequest(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
        body,
      );
      await notifyUser(app, out.userId, {
        approved: true,
        credits: out.credits,
        adminNote: body.adminNote || null,
      });
      return { id: out.id, status: out.status, credits: out.credits };
    },
  );

  app.post(
    '/admin/refund-requests/:id/reject',
    { preHandler: RW, schema: { params: idParams, body: AdminRejectRefundBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as AdminRejectRefundBody;
      const out = await adminRejectRefundRequest(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
        body,
      );
      await notifyUser(app, out.userId, {
        approved: false,
        credits: out.credits,
        adminNote: body.adminNote,
      });
      return { id: out.id, status: out.status };
    },
  );
}
