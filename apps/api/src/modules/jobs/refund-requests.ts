import type { DB, DbTransaction } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { creditsRefundedTotal } from '@aivastra/observability';
import { CreateRefundRequestBody } from '@aivastra/types';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendRefundDecisionEmail } from '../../lib/mailer.js';
import { getRefundAutoApproveConfig } from '../../lib/refund-auto-approve-config.js';
import { recordAudit } from '../admin/audit.js';
import { applyRefundTx } from '../credits/ledger.js';

const R = schema.refundRequests;
const L = schema.creditLedger;
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

/** True once a refund request on the job was APPROVED: the credits are back, so the full image is withheld. */
export async function hasApprovedRefundRequest(db: DB, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: R.id })
    .from(R)
    .where(and(eq(R.jobId, jobId), eq(R.status, 'APPROVED')))
    .limit(1);
  return !!row;
}

/**
 * True when any job was regenerated from this one (a row with parent_job_id = jobId),
 * whatever the child's status. Regenerate is free, so refunding the original as well
 * would let the customer keep both images.
 */
export async function hasRegeneratedChild(db: DB | DbTransaction, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.parentJobId, jobId))
    .limit(1);
  return !!row;
}

/**
 * Net credits the ledger shows for (job, user): the debit plus any refunds already
 * written against it. Negative means credits are still out of the user's balance.
 * This — not jobs.creditsCharged — is what a refund may return: an unlimited-plan job
 * keeps its plan cost in creditsCharged but writes a delta-0 ledger row, and a job an
 * admin cancel or the dispatcher already refunded nets back to zero.
 */
export async function ledgerNetForJob(
  db: DB | DbTransaction,
  jobId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ net: sql<number>`coalesce(sum(${L.delta}), 0)::int` })
    .from(L)
    .where(and(eq(L.jobId, jobId), eq(L.userId, userId)));
  return row?.net ?? 0;
}

/**
 * Single source of truth for "can this job be refund-requested", shared by the
 * create route (which throws) and the status route (which reports a boolean) so
 * the button and the server can never disagree. `ledgerNet` is the job's net ledger
 * delta for its owner (see `ledgerNetForJob`). Null means eligible.
 */
export function refundIneligibility(
  job: JobRow,
  downloadedAt: Date | null,
  hasRequest: boolean,
  ledgerNet: number,
  hasChild: boolean,
): { code: string; message: string } | null {
  if (job.status !== 'COMPLETED') return { code: 'NOT_READY', message: 'job not complete' };
  // Free regenerations charge 0, unlimited-plan jobs debit 0 in the ledger, and a job
  // already refunded by another path nets to 0 — there is nothing to return.
  // Merchant, API-key and Shopify jobs bill a different balance than the user's.
  if (
    job.creditsCharged <= 0 ||
    ledgerNet >= 0 ||
    job.merchantId ||
    job.apiKeyId ||
    job.shopifyStoreId
  ) {
    return { code: 'NOT_REFUNDABLE', message: 'this job has no refundable credits' };
  }
  if (downloadedAt) {
    return {
      code: 'ALREADY_DOWNLOADED',
      message: 'this result has already been downloaded and can no longer be refunded',
    };
  }
  if (hasChild) {
    return {
      code: 'ALREADY_REGENERATED',
      message: 'this image was regenerated, so it can no longer be refunded',
    };
  }
  if (hasRequest) {
    return { code: 'REFUND_ALREADY_REQUESTED', message: 'a refund was already requested' };
  }
  return null;
}

export type Actor = { userId: string; role: string };

export type RefundRequestRow = typeof R.$inferSelect;

/**
 * Shared approve body used by the admin button and the auto-approve path so the
 * two can never diverge: re-checks, ledger refund, status flip and audit row in
 * the caller's transaction (or savepoint). The row must already be locked by the
 * caller, and PENDING-checked by the admin wrapper (the auto path inserts it as
 * PENDING moments earlier). Metrics and email stay with the callers — they run
 * post-commit. Ledger reason is always REFUND_USER_REQUEST either way.
 */
export async function approveRefundRequestTx(
  tx: DbTransaction,
  row: RefundRequestRow,
  opts: {
    actor: Actor;
    adminNote: string | null;
    autoApproved: boolean;
    action: 'refund_request.approve' | 'refund_request.auto_approve';
    request?: FastifyRequest;
  },
) {
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
  // Regenerate is free: if one slipped in as the request was filed, the customer
  // already has a replacement image, so refunding the original would double-dip.
  if (await hasRegeneratedChild(tx, row.jobId)) {
    throw new AppError(
      'ALREADY_REGENERATED',
      409,
      'this image was regenerated, so it can no longer be refunded',
    );
  }
  const net = await ledgerNetForJob(tx, row.jobId, row.userId);
  if (-net < row.credits) {
    throw new AppError(
      'NOT_REFUNDABLE',
      409,
      'credits for this job were already refunded or were never charged',
    );
  }

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
      adminNote: opts.adminNote,
      reviewedBy: opts.autoApproved ? null : opts.actor.userId,
      reviewedAt: now,
      autoApproved: opts.autoApproved,
    })
    .where(and(eq(R.id, row.id), eq(R.status, 'PENDING')));

  await recordAudit(tx, {
    actor: opts.actor,
    action: opts.action,
    resourceType: 'refund_requests',
    resourceId: row.id,
    before: { status: 'PENDING' },
    after: { status: 'APPROVED', credits: row.credits, adminNote: opts.adminNote },
    request: opts.request,
  });
  return { id: row.id, status: 'APPROVED' as const, credits: row.credits, userId: row.userId };
}

/** Best-effort: a failed email must never undo a committed decision. */
export async function notifyRefundDecision(
  app: FastifyInstance,
  userId: string,
  decision: { approved: boolean; credits: number; adminNote: string | null },
) {
  try {
    const [user] = await app.db
      .select({ email: schema.users.email, displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user?.email) return;
    await sendRefundDecisionEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, user.email, {
      ...decision,
      name: user.displayName,
    });
  } catch (err) {
    app.log.error({ err, userId }, 'Failed to send refund decision email');
  }
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
    const net = await ledgerNetForJob(tx, jobId, userId);
    const hasChild = await hasRegeneratedChild(tx, jobId);

    const problem = refundIneligibility(
      job,
      output?.downloadedAt ?? null,
      !!existing,
      net,
      hasChild,
    );
    if (problem) throw new AppError(problem.code, 409, problem.message);

    const [row] = await tx
      .insert(R)
      .values({
        jobId,
        userId,
        // What the ledger actually took, not the job's list price.
        credits: -net,
        reasonCode: body.reasonCode,
        note: body.note || null,
      })
      .returning();
    const pending = {
      id: row.id,
      jobId: row.jobId,
      status: row.status,
      credits: row.credits,
      reasonCode: row.reasonCode,
      note: row.note,
      createdAt: row.createdAt,
      autoApproved: false,
    };

    // Auto-approve runs in a nested transaction (savepoint): any failure rolls back
    // only the approval, leaving the request PENDING. The customer's request never
    // fails because of auto-approve.
    const cfg = await getRefundAutoApproveConfig(app);
    if (!cfg.enabled) return pending;

    const [{ autoCount }] = await tx
      .select({ autoCount: sql<number>`count(*)::int` })
      .from(R)
      .where(
        and(
          eq(R.userId, userId),
          eq(R.autoApproved, true),
          gt(R.reviewedAt, sql`now() - interval '24 hours'`),
        ),
      );
    if (autoCount >= cfg.dailyCap) return pending;

    try {
      await tx.transaction((sp) =>
        approveRefundRequestTx(sp, row, {
          actor: { userId, role: 'AUTO_APPROVE' },
          adminNote: 'Auto-approved',
          autoApproved: true,
          action: 'refund_request.auto_approve',
        }),
      );
    } catch (err) {
      app.log.warn({ err, jobId, userId }, 'auto-approve failed, leaving request PENDING');
      return pending;
    }
    return { ...pending, status: 'APPROVED', autoApproved: true };
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
  // One grouped query for every owned job's net, not one per job.
  const nets = owned.length
    ? await app.db
        .select({ jobId: L.jobId, net: sql<number>`coalesce(sum(${L.delta}), 0)::int` })
        .from(L)
        .where(and(inArray(L.jobId, owned), eq(L.userId, userId)))
        .groupBy(L.jobId)
    : [];
  const netByJob = new Map(nets.map((n) => [n.jobId, n.net]));
  // One grouped query for every owned job's regenerated children, not one per job.
  const children = owned.length
    ? await app.db
        .selectDistinct({ parentJobId: schema.jobs.parentJobId })
        .from(schema.jobs)
        .where(inArray(schema.jobs.parentJobId, owned))
    : [];
  const regenerated = new Set(children.map((c) => c.parentJobId));

  return jobs.map(({ job, downloadedAt }) => {
    const req = byJob.get(job.id);
    const net = netByJob.get(job.id) ?? 0;
    return {
      jobId: job.id,
      eligible:
        refundIneligibility(job, downloadedAt ?? null, !!req, net, regenerated.has(job.id)) ===
        null,
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
      // The web UI sends one request per ticked image, so a batch refund is many calls in a
      // row. The unique job_id (one request per job) is the real abuse brake, not this.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const created = await createRefundRequest(
        app,
        req.userId,
        id,
        req.body as CreateRefundRequestBody,
      );
      if (created.autoApproved) {
        creditsRefundedTotal.inc(created.credits);
        await notifyRefundDecision(app, req.userId, {
          approved: true,
          credits: created.credits,
          adminNote: 'Auto-approved',
        });
      }
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
