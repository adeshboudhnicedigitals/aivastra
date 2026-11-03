import { type DB, schema } from '@aivastra/db';
import { fleetJobActionSchema, JOB_REFUND_REASONS } from '@aivastra/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import { cancelJobAndRefund } from '../credits/ledger.js';
import { cancelBlock, retryBlock, retryStream } from './job-actions-core.js';

const params = z.object({ id: z.string().uuid() });

/**
 * Cancel a queued job / retry a failed one, with a reason and an audit row in the same
 * transaction. The dispatcher already ACKs stream entries whose job row is terminal, so a
 * cancelled queued job simply drops out when its message is read.
 */
export async function fleetJobActionRoutes(app: FastifyInstance) {
  const actor = (req: { userId: string; adminRole?: unknown }) => ({
    userId: req.userId,
    role: req.adminRole as string,
  });

  app.post(
    '/admin/fleet/jobs/:id/cancel',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params, body: fleetJobActionSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof params>;
      const { reason } = req.body as z.infer<typeof fleetJobActionSchema>;
      return app.db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.id, id))
          .for('update');
        if (!job) throw new AppError('NOT_FOUND', 404, 'Job not found');
        const blocked = cancelBlock(job);
        if (blocked) throw new AppError('JOB_NOT_CANCELLABLE', 409, blocked);
        // The helper opens its own transaction; on `tx` that becomes a savepoint, so the status
        // change, the refund and the audit row commit or roll back together.
        const { claimed } = await cancelJobAndRefund(tx as unknown as DB, {
          jobId: id,
          userId: job.userId,
          amount: job.creditsCharged,
          refundReason: 'REFUND_ADMIN_CANCEL',
          errorCode: 'ADMIN_CANCEL',
        });
        if (!claimed)
          throw new AppError(
            'JOB_NOT_CANCELLABLE',
            409,
            'The job changed state; nothing was cancelled.',
          );
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.job.cancel',
          resourceType: 'job',
          resourceId: id,
          before: { status: job.status, creditsCharged: job.creditsCharged },
          after: { status: 'CANCELLED', reason },
          request: req,
        });
        return {
          ok: true as const,
          jobId: id,
          status: 'CANCELLED' as const,
          refunded: job.creditsCharged > 0,
        };
      });
    },
  );

  app.post(
    '/admin/fleet/jobs/:id/retry',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params, body: fleetJobActionSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof params>;
      const { reason } = req.body as z.infer<typeof fleetJobActionSchema>;
      return app.db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.id, id))
          .for('update');
        if (!job) throw new AppError('NOT_FOUND', 404, 'Job not found');
        const blocked = retryBlock(job);
        if (blocked) throw new AppError('JOB_NOT_RETRYABLE', 409, blocked);
        const [prior] = await tx
          .select({ id: schema.creditLedger.id })
          .from(schema.creditLedger)
          .where(
            and(
              eq(schema.creditLedger.jobId, id),
              inArray(schema.creditLedger.reason, [...JOB_REFUND_REASONS]),
            ),
          )
          .limit(1);
        await tx
          .update(schema.jobs)
          .set({ status: 'QUEUED', errorCode: null, attempts: 0 })
          .where(eq(schema.jobs.id, id));
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.job.retry',
          resourceType: 'job',
          resourceId: id,
          before: { status: 'FAILED', errorCode: job.errorCode },
          after: { status: 'QUEUED', reason, previouslyRefunded: Boolean(prior) },
          request: req,
        });
        // Last, so a Redis failure rolls the whole thing back instead of leaving a QUEUED row
        // that no stream entry points at.
        await app.redis.xadd(
          retryStream(job),
          'MAXLEN',
          '~',
          10000,
          '*',
          'jobId',
          id,
          'userId',
          job.userId ?? '',
        );
        return {
          ok: true as const,
          jobId: id,
          status: 'QUEUED' as const,
          refunded: Boolean(prior),
        };
      });
    },
  );
}
