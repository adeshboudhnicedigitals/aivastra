import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { CreateRefundRequestBody } from '@aivastra/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const R = schema.refundRequests;
const ACTIVE_STATUSES = ['PENDING', 'APPROVED'];
const MAX_STATUS_IDS = 50;

type JobRow = typeof schema.jobs.$inferSelect;

/**
 * True while a refund request holds the job: PENDING (decision outstanding) or
 * APPROVED (credits returned). Regenerate and download both refuse in that state;
 * a REJECTED request releases the job again.
 */
export async function hasActiveRefundRequest(db: DB, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: R.id })
    .from(R)
    .where(and(eq(R.jobId, jobId), inArray(R.status, ACTIVE_STATUSES)))
    .limit(1);
  return !!row;
}

/**
 * Single source of truth for "can this job be refund-requested", shared by the
 * create route (which throws) and the status route (which reports a boolean) so
 * the button and the server can never disagree. Null means eligible.
 */
export function refundIneligibility(
  job: JobRow,
  downloadedAt: Date | null,
  hasRequest: boolean,
): { code: string; message: string } | null {
  if (job.status !== 'COMPLETED') return { code: 'NOT_READY', message: 'job not complete' };
  // Free regenerations and unlimited-plan jobs charge 0 — there is nothing to return.
  // Merchant, API-key and Shopify jobs bill a different balance than the user's.
  if (job.creditsCharged <= 0 || job.merchantId || job.apiKeyId || job.shopifyStoreId) {
    return { code: 'NOT_REFUNDABLE', message: 'this job has no refundable credits' };
  }
  if (downloadedAt) {
    return {
      code: 'ALREADY_DOWNLOADED',
      message: 'this result has already been downloaded and can no longer be refunded',
    };
  }
  if (hasRequest) {
    return { code: 'REFUND_ALREADY_REQUESTED', message: 'a refund was already requested' };
  }
  return null;
}

export async function createRefundRequest(
  app: FastifyInstance,
  userId: string,
  jobId: string,
  body: CreateRefundRequestBody,
) {
  return app.db.transaction(async (tx) => {
    // Lock the job row so two simultaneous requests serialise: the second one sees
    // the first one's row and gets REFUND_ALREADY_REQUESTED, not a unique violation.
    const [job] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.userId, userId)))
      .for('update');
    if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');

    const [output] = await tx
      .select({ downloadedAt: schema.jobOutputs.downloadedAt })
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    const [existing] = await tx.select({ id: R.id }).from(R).where(eq(R.jobId, jobId)).limit(1);

    const problem = refundIneligibility(job, output?.downloadedAt ?? null, !!existing);
    if (problem) throw new AppError(problem.code, 409, problem.message);

    const [row] = await tx
      .insert(R)
      .values({
        jobId,
        userId,
        credits: job.creditsCharged,
        reasonCode: body.reasonCode,
        note: body.note || null,
      })
      .returning();
    return {
      id: row.id,
      jobId: row.jobId,
      status: row.status,
      credits: row.credits,
      reasonCode: row.reasonCode,
      note: row.note,
      createdAt: row.createdAt,
    };
  });
}

export async function getRefundStatuses(app: FastifyInstance, userId: string, jobIds: string[]) {
  const jobs = await app.db
    .select({
      job: schema.jobs,
      downloadedAt: schema.jobOutputs.downloadedAt,
    })
    .from(schema.jobs)
    .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
    .where(and(inArray(schema.jobs.id, jobIds), eq(schema.jobs.userId, userId)));

  const owned = jobs.map((j) => j.job.id);
  const requests = owned.length ? await app.db.select().from(R).where(inArray(R.jobId, owned)) : [];
  const byJob = new Map(requests.map((r) => [r.jobId, r]));

  return jobs.map(({ job, downloadedAt }) => {
    const req = byJob.get(job.id);
    return {
      jobId: job.id,
      eligible: refundIneligibility(job, downloadedAt ?? null, !!req) === null,
      request: req
        ? {
            status: req.status,
            reasonCode: req.reasonCode,
            adminNote: req.adminNote,
            createdAt: req.createdAt,
            reviewedAt: req.reviewedAt,
          }
        : null,
    };
  });
}

export async function refundRequestsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/jobs/:id/refund-request',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }), body: CreateRefundRequestBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const created = await createRefundRequest(
        app,
        req.userId,
        id,
        req.body as CreateRefundRequestBody,
      );
      return reply.code(201).send(created);
    },
  );

  // Static segment beats /v1/jobs/:id in the router, so this does not collide with it.
  app.get(
    '/v1/jobs/refund-status',
    {
      preHandler: app.requireUser,
      schema: { querystring: z.object({ jobIds: z.string().min(1) }) },
    },
    async (req) => {
      const { jobIds } = req.query as { jobIds: string };
      const ids = z
        .array(z.string().uuid())
        .min(1)
        .max(MAX_STATUS_IDS)
        .safeParse(jobIds.split(','));
      if (!ids.success) {
        throw new AppError(
          'VALIDATION',
          400,
          `jobIds must be 1-${MAX_STATUS_IDS} comma-separated uuids`,
        );
      }
      return { items: await getRefundStatuses(app, req.userId, ids.data) };
    },
  );
}
