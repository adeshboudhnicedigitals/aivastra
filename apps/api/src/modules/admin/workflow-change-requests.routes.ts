import { type DbTransaction, schema } from '@aivastra/db';
import {
  ApproveWorkflowChangeRequestBody,
  CreateWorkflowBody,
  ProposeWorkflowChangeRequestBody,
  RejectWorkflowChangeRequestBody,
  UpdateWorkflowBody,
} from '@aivastra/types';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { getRolePermissions, requirePermission } from './guard.js';
import {
  type ReassignWorkflowMappingsSummary,
  reassignAllWorkflowMappings,
} from './workflow-mapping-reassign.js';
import { createWorkflowRow, updateWorkflowRow } from './workflows.routes.js';

const uuidParam = z.object({ id: z.string().uuid() });
const ListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  targetWorkflowId: z.string().uuid().optional(),
});

// Joined shape used by both the list and detail endpoints — proposer/approver
// name+email and target/resulting workflow labels are resolved server-side so
// the admin UI never needs a second round-trip per row.
function changeRequestQuery(app: FastifyInstance) {
  const proposer = alias(schema.users, 'cr_proposer');
  const approver = alias(schema.users, 'cr_approver');
  const targetWf = alias(schema.workflowTemplates, 'cr_target_wf');
  const resultingWf = alias(schema.workflowTemplates, 'cr_resulting_wf');

  return app.db
    .select({
      id: schema.workflowChangeRequests.id,
      changeType: schema.workflowChangeRequests.changeType,
      targetWorkflowId: schema.workflowChangeRequests.targetWorkflowId,
      targetWorkflowLabel: targetWf.label,
      proposedBy: schema.workflowChangeRequests.proposedBy,
      proposedByEmail: proposer.email,
      proposedByRole: schema.workflowChangeRequests.proposedByRole,
      reason: schema.workflowChangeRequests.reason,
      previousLimitations: schema.workflowChangeRequests.previousLimitations,
      proposedFields: schema.workflowChangeRequests.proposedFields,
      status: schema.workflowChangeRequests.status,
      reviewedBy: schema.workflowChangeRequests.reviewedBy,
      reviewedByEmail: approver.email,
      reviewedAt: schema.workflowChangeRequests.reviewedAt,
      reviewNote: schema.workflowChangeRequests.reviewNote,
      resultingWorkflowId: schema.workflowChangeRequests.resultingWorkflowId,
      resultingWorkflowLabel: resultingWf.label,
      createdAt: schema.workflowChangeRequests.createdAt,
      updatedAt: schema.workflowChangeRequests.updatedAt,
    })
    .from(schema.workflowChangeRequests)
    .innerJoin(proposer, eq(proposer.id, schema.workflowChangeRequests.proposedBy))
    .leftJoin(approver, eq(approver.id, schema.workflowChangeRequests.reviewedBy))
    .leftJoin(targetWf, eq(targetWf.id, schema.workflowChangeRequests.targetWorkflowId))
    .leftJoin(resultingWf, eq(resultingWf.id, schema.workflowChangeRequests.resultingWorkflowId));
}

async function canReviewAll(app: FastifyInstance, role: string): Promise<boolean> {
  const perms = await getRolePermissions(app, role);
  return perms.has('workflow_change_requests.review');
}

export async function adminWorkflowChangeRequestsRoutes(app: FastifyInstance) {
  const Propose = requirePermission('workflow_change_requests.propose');
  const Review = requirePermission('workflow_change_requests.review');

  // POST /admin/workflow-change-requests
  app.post(
    '/admin/workflow-change-requests',
    { preHandler: Propose, schema: { body: ProposeWorkflowChangeRequestBody } },
    async (req) => {
      const body = req.body as z.infer<typeof ProposeWorkflowChangeRequestBody>;

      // No target on a 'create' = add a brand-new workflow, nothing to replace.
      if (body.targetWorkflowId) {
        const [target] = await app.db
          .select()
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, body.targetWorkflowId));
        if (!target) throw new AppError('NOT_FOUND', 404, 'target workflow not found');

        if (body.changeType === 'create' && !target.isActive) {
          throw new AppError(
            'VALIDATION',
            400,
            'target workflow is already inactive — pick the active workflow this should replace',
          );
        }
      }

      // Structural validation against the same schema a direct create/update would
      // require. Deep JSON-node validation (does this node id actually exist in
      // the graph, is it the right node type) happens later, at approval time,
      // inside createWorkflowRow/updateWorkflowRow against the real row.
      const parsed =
        body.changeType === 'create'
          ? CreateWorkflowBody.safeParse(body.proposedFields)
          : UpdateWorkflowBody.safeParse(body.proposedFields);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION',
          400,
          `proposedFields invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        );
      }

      const row = await app.db.transaction(async (tx: DbTransaction) => {
        const [inserted] = await tx
          .insert(schema.workflowChangeRequests)
          .values({
            changeType: body.changeType,
            targetWorkflowId: body.targetWorkflowId ?? null,
            proposedBy: req.userId,
            // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
            proposedByRole: req.adminRole!,
            reason: body.reason,
            previousLimitations: body.previousLimitations?.trim() || null,
            proposedFields: parsed.data as Record<string, unknown>,
          })
          .returning();
        if (!inserted) throw new AppError('INSERT_FAILED', 500, 'failed to create change request');

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow_change_request.propose',
          resourceType: 'workflow_change_request',
          resourceId: inserted.id,
          after: {
            changeType: inserted.changeType,
            targetWorkflowId: inserted.targetWorkflowId,
          },
          request: req,
        });

        return inserted;
      });

      return row;
    },
  );

  // GET /admin/workflow-change-requests
  app.get(
    '/admin/workflow-change-requests',
    { preHandler: Propose, schema: { querystring: ListQuery } },
    async (req) => {
      const { status, targetWorkflowId } = req.query as z.infer<typeof ListQuery>;
      // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
      const seeAll = await canReviewAll(app, req.adminRole!);

      const conditions = [
        status ? eq(schema.workflowChangeRequests.status, status) : undefined,
        targetWorkflowId
          ? eq(schema.workflowChangeRequests.targetWorkflowId, targetWorkflowId)
          : undefined,
        // Non-super-admins only ever see their own proposals — the full pending
        // queue is SUPER_ADMIN-only (or any future role granted the review permission).
        seeAll ? undefined : eq(schema.workflowChangeRequests.proposedBy, req.userId),
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      return changeRequestQuery(app)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.workflowChangeRequests.createdAt));
    },
  );

  // GET /admin/workflow-change-requests/:id
  app.get(
    '/admin/workflow-change-requests/:id',
    { preHandler: Propose, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
      const seeAll = await canReviewAll(app, req.adminRole!);

      const [row] = await changeRequestQuery(app).where(eq(schema.workflowChangeRequests.id, id));
      // 404, not 403, for someone else's row — avoids leaking existence to a
      // non-super-admin who isn't the proposer.
      if (!row || (!seeAll && row.proposedBy !== req.userId)) {
        throw new AppError('NOT_FOUND', 404, 'change request not found');
      }
      return row;
    },
  );

  // POST /admin/workflow-change-requests/:id/approve
  app.post(
    '/admin/workflow-change-requests/:id/approve',
    { preHandler: Review, schema: { params: uuidParam, body: ApproveWorkflowChangeRequestBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof ApproveWorkflowChangeRequestBody>;
      // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
      const actor = { userId: req.userId, role: req.adminRole! };

      const updated = await app.db.transaction(async (tx: DbTransaction) => {
        const [cr] = await tx
          .select()
          .from(schema.workflowChangeRequests)
          .where(eq(schema.workflowChangeRequests.id, id))
          .for('update');
        if (!cr) throw new AppError('NOT_FOUND', 404, 'change request not found');
        if (cr.status !== 'pending') {
          throw new AppError('CONFLICT', 409, 'change request is not pending');
        }
        // A missing target is valid only for a 'create' (add-new proposal). An
        // 'update' without one is a legacy/orphaned row (target deleted).
        if (!cr.targetWorkflowId && cr.changeType !== 'create') {
          throw new AppError(
            'VALIDATION',
            400,
            'this change request has no target workflow and cannot be auto-approved',
          );
        }

        let resultingWorkflowId: string;
        let mappingsSummary: ReassignWorkflowMappingsSummary | undefined;

        if (cr.changeType === 'create') {
          const proposedFields = CreateWorkflowBody.parse(cr.proposedFields);
          const targetId = cr.targetWorkflowId;
          const created = await createWorkflowRow(
            tx,
            proposedFields,
            actor,
            { changeRequestId: cr.id, continuesFromWorkflowId: targetId ?? undefined },
            req,
          );
          resultingWorkflowId = created.id;

          if (targetId) {
            const [targetBefore] = await tx
              .select()
              .from(schema.workflowTemplates)
              .where(eq(schema.workflowTemplates.id, targetId))
              .for('update');
            if (targetBefore?.isActive) {
              await tx
                .update(schema.workflowTemplates)
                .set({ isActive: false, updatedAt: new Date() })
                .where(eq(schema.workflowTemplates.id, targetId));

              await recordAudit(tx, {
                actor,
                action: 'workflow.deactivate',
                resourceType: 'workflow',
                resourceId: targetId,
                before: { isActive: true },
                after: { isActive: false, replacedByWorkflowId: resultingWorkflowId },
                request: req,
              });
            }

            // The new row is otherwise an island — nothing routes a job to it yet.
            // Move every pose/garment-type/category/funnel/saree-setting that used
            // the replaced workflow onto the new one, so the replacement takes over
            // exactly the assets the old workflow served.
            mappingsSummary = await reassignAllWorkflowMappings(tx, {
              fromWorkflowId: targetId,
              toWorkflowId: resultingWorkflowId,
              actor,
              request: req,
            });
          }
        } else {
          const proposedFields = UpdateWorkflowBody.parse(cr.proposedFields);
          await updateWorkflowRow(
            tx,
            cr.targetWorkflowId as string,
            proposedFields,
            actor,
            { changeRequestId: cr.id },
            req,
          );
          resultingWorkflowId = cr.targetWorkflowId as string;
        }

        const [row] = await tx
          .update(schema.workflowChangeRequests)
          .set({
            status: 'approved',
            reviewedBy: req.userId,
            reviewedAt: new Date(),
            reviewNote: body.reviewNote ?? null,
            resultingWorkflowId,
            updatedAt: new Date(),
          })
          .where(eq(schema.workflowChangeRequests.id, id))
          .returning();
        if (!row) throw new AppError('INSERT_FAILED', 500, 'failed to update change request');

        await recordAudit(tx, {
          actor,
          action: 'workflow_change_request.approve',
          resourceType: 'workflow_change_request',
          resourceId: id,
          before: { status: cr.status },
          after: { status: 'approved', resultingWorkflowId },
          request: req,
        });

        return { ...row, mappingsSummary };
      });

      return updated;
    },
  );

  // POST /admin/workflow-change-requests/:id/reject
  app.post(
    '/admin/workflow-change-requests/:id/reject',
    { preHandler: Review, schema: { params: uuidParam, body: RejectWorkflowChangeRequestBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof RejectWorkflowChangeRequestBody>;

      const updated = await app.db.transaction(async (tx: DbTransaction) => {
        const [cr] = await tx
          .select()
          .from(schema.workflowChangeRequests)
          .where(eq(schema.workflowChangeRequests.id, id))
          .for('update');
        if (!cr) throw new AppError('NOT_FOUND', 404, 'change request not found');
        if (cr.status !== 'pending') {
          throw new AppError('CONFLICT', 409, 'change request is not pending');
        }

        const [row] = await tx
          .update(schema.workflowChangeRequests)
          .set({
            status: 'rejected',
            reviewedBy: req.userId,
            reviewedAt: new Date(),
            reviewNote: body.reviewNote,
            updatedAt: new Date(),
          })
          .where(eq(schema.workflowChangeRequests.id, id))
          .returning();
        if (!row) throw new AppError('INSERT_FAILED', 500, 'failed to update change request');

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow_change_request.reject',
          resourceType: 'workflow_change_request',
          resourceId: id,
          before: { status: cr.status },
          after: { status: 'rejected', reviewNote: body.reviewNote },
          request: req,
        });

        return row;
      });

      return updated;
    },
  );
}
