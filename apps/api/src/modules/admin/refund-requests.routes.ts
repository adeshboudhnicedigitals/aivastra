import { schema } from '@aivastra/db';
import { creditsRefundedTotal } from '@aivastra/observability';
import { keys } from '@aivastra/storage';
import {
  AdminApproveRefundBody,
  AdminRejectRefundBody,
  fillRefundAutoApproveDefaults,
  RefundAutoApprovePatch,
  RefundStatus,
} from '@aivastra/types';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  type Actor,
  approveRefundRequestTx,
  notifyRefundDecision,
} from '../jobs/refund-requests.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const R = schema.refundRequests;

const AUTO_APPROVE_KEY = 'config:refund-auto-approve';

const ListQuery = z.object({
  status: RefundStatus.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

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
    return approveRefundRequestTx(tx, row, {
      actor,
      adminNote: body.adminNote || null,
      autoApproved: false,
      action: 'refund_request.approve',
      request,
    });
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
          autoApproved: R.autoApproved,
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
      await notifyRefundDecision(app, out.userId, {
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
      await notifyRefundDecision(app, out.userId, {
        approved: false,
        credits: out.credits,
        adminNote: body.adminNote,
      });
      return { id: out.id, status: out.status };
    },
  );

  app.get('/admin/refund-requests/auto-approve', { preHandler: RO }, async () => {
    const raw = await app.redis.get(AUTO_APPROVE_KEY);
    return fillRefundAutoApproveDefaults(JSON.parse(raw ?? '{}'));
  });

  app.patch(
    '/admin/refund-requests/auto-approve',
    { preHandler: RW, schema: { body: RefundAutoApprovePatch } },
    async (req) => {
      const before = fillRefundAutoApproveDefaults(
        JSON.parse((await app.redis.get(AUTO_APPROVE_KEY)) ?? '{}'),
      );
      // Merge onto the existing (default-filled) config — PATCH is partial, so
      // a wholesale overwrite would silently revert untouched fields.
      const after = { ...before, ...(req.body as typeof before) };

      // Audit first: a config change must never land without its Team Activity
      // entry (same ordering as the image-compression PATCH).
      await app.db.transaction(async (tx) => {
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'refund_auto_approve.update',
          resourceType: 'system_config',
          resourceId: 'refund_auto_approve',
          before,
          after,
          request: req,
        });
      });
      await app.redis.set(AUTO_APPROVE_KEY, JSON.stringify(after));
      return after;
    },
  );
}
