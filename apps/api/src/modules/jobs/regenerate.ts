import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { resolveQueueRouting } from './create.js';
import { promptGuard } from './sanitize.js';

const FREE_REGENERATE_DAILY_LIMIT = 5;
const FREE_REGENERATE_LIMIT_ENABLED = true;

function freeRegenerateKey(userId: string): string {
  // UTC calendar day — a fixed boundary is simpler and good enough for a soft
  // daily allowance; no need to account for the user's own timezone here.
  const day = new Date().toISOString().slice(0, 10);
  return `regen:free:${userId}:${day}`;
}

async function getFreeRegenerateCount(app: FastifyInstance, userId: string): Promise<number> {
  const raw = await app.redis.get(freeRegenerateKey(userId));
  return raw ? Number(raw) : 0;
}

async function incrementFreeRegenerateCount(app: FastifyInstance, userId: string): Promise<void> {
  const key = freeRegenerateKey(userId);
  const count = await app.redis.incr(key);
  // Only the first increment of the day sets the expiry — a 2-day TTL is a
  // generous safety buffer so a clock skew or slow request near midnight can
  // never leave the key stuck permanently.
  if (count === 1) await app.redis.expire(key, 172_800);
}

/** The one admin-configured regeneration workflow. Every regenerate click
 *  runs through it, regardless of what produced the original image — see
 *  docs/superpowers/specs/2026-08-31-dedicated-regeneration-workflow-design.md. */
async function getActiveRegenerationTemplate(app: FastifyInstance) {
  const [row] = await app.db
    .select({
      id: schema.workflowTemplates.id,
      version: schema.workflowTemplates.version,
      regenerationReasonPrompts: schema.workflowTemplates.regenerationReasonPrompts,
    })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'regeneration'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolves the reason labels to offer for regenerating a given job. These are
 * no longer job-specific — every job regenerates through the same single
 * workflow, so this is just that workflow's configured reason list. jobId is
 * still required and validated (ownership + existence) so a caller can't
 * probe reasons for a job they don't own via this endpoint.
 */
export async function getRegenerateReasons(
  app: FastifyInstance,
  userId: string,
  jobId: string,
): Promise<string[]> {
  const [job] = await app.db
    .select({ userId: schema.jobs.userId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (job.userId !== userId) throw new AppError('NOT_FOUND', 404, 'job not found');

  const template = await getActiveRegenerationTemplate(app);
  if (!template) return [];
  return template.regenerationReasonPrompts.map((p) => p.reason);
}

/**
 * Regenerate = a brand-new job that runs the single dedicated regeneration
 * ComfyUI workflow, taking the ORIGINAL job's own generated output as its
 * only input — never the original job's own pipeline (studio/tryon-direct/
 * saree all funnel through this one path now). Always free
 * (creditsCharged: 0) within today's allowance — never charge-then-refund,
 * so every existing refund path naturally no-ops for it (they all guard on
 * `creditsCharged > 0`).
 */
export async function regenerateJob(
  app: FastifyInstance,
  userId: string,
  originalJobId: string,
  reason: string,
) {
  const cleanReason = promptGuard(reason);
  if (!cleanReason) throw new AppError('VALIDATION', 400, 'a reason is required to regenerate');

  const [original] = await app.db
    .select({
      job: schema.jobs,
      resultKey: schema.jobOutputs.resultKey,
      downloadedAt: schema.jobOutputs.downloadedAt,
    })
    .from(schema.jobs)
    .leftJoin(schema.jobOutputs, eq(schema.jobs.id, schema.jobOutputs.jobId))
    .where(eq(schema.jobs.id, originalJobId));

  if (!original) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.userId !== userId) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.status !== 'COMPLETED') {
    throw new AppError('CONFLICT', 409, 'can only regenerate completed jobs');
  }
  if (original.downloadedAt) {
    throw new AppError(
      'ALREADY_DOWNLOADED',
      409,
      'this result has already been downloaded and can no longer be regenerated',
    );
  }

  if (FREE_REGENERATE_LIMIT_ENABLED) {
    const freeUsedToday = await getFreeRegenerateCount(app, userId);
    if (freeUsedToday >= FREE_REGENERATE_DAILY_LIMIT) {
      throw new AppError(
        'FREE_REGENERATE_LIMIT',
        429,
        `You've used all ${FREE_REGENERATE_DAILY_LIMIT} free regenerations for today. Please contact customer support for more.`,
      );
    }
  }

  const template = await getActiveRegenerationTemplate(app);
  if (!template) {
    throw new AppError('CONFIG', 400, 'regeneration is not configured by admin');
  }

  // Legacy rows (predating job_outputs.resultKey being populated for every
  // job) fall back to the PNG convention — same fallback createCatalogVideoJob
  // already uses for "reuse a completed job's own result as an input image."
  const sourceImageKey = original.resultKey ?? keys.output(originalJobId);

  // A non-empty match becomes the prompt/instruction override; no match (or a
  // blank configured prompt/instruction, e.g. "Other") means the workflow's
  // own baked-in defaults run unchanged — same "empty = no override"
  // convention documented on regenerationReasonPrompts.
  const matchedReason = template.regenerationReasonPrompts.find((p) => p.reason === cleanReason);
  const promptOverride = matchedReason?.prompt;
  const instructionOverride = matchedReason?.instruction;

  const { queueStream, priority, watermark } = await resolveQueueRouting(app, userId);

  const newJobId = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: 0,
        source: JOB_SOURCE.REGENERATE,
        parentJobId: originalJobId,
      })
      .returning();
    if (!newJob) throw new AppError('INSERT_FAILED', 500, 'failed to create regenerate job');

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      params: {
        kind: 'regenerate',
        sourceImageKey,
        sourceJobId: originalJobId,
        workflowTemplateId: template.id,
        dispatchTemplateVersion: template.version,
        ...(promptOverride?.trim() ? { promptOverride } : {}),
        ...(instructionOverride?.trim() ? { instructionOverride } : {}),
      },
    });

    // Logged against the NEW job (not the original) — parentJobId already
    // links back to the original on the jobs row itself, and admins
    // reviewing a regenerated job want the reason available right there.
    await tx.insert(schema.jobEvents).values({
      jobId: newJob.id,
      eventType: 'REGENERATE_REASON',
      payload: { reason: cleanReason, parentJobId: originalJobId },
    });

    return newJob.id;
  });

  const stream = `jobs:${queueStream}`;
  await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', newJobId, 'userId', userId);

  // Skipped while the cap is disabled too — otherwise local testing would
  // silently burn through the real quota and the very first regenerate after
  // re-enabling it could already be over the limit.
  if (FREE_REGENERATE_LIMIT_ENABLED) await incrementFreeRegenerateCount(app, userId);

  return { jobId: newJobId };
}
