import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createDevJobCore } from '../dev/create-job.js';
import { resolveQueueRouting, verifyGarmentKey } from '../jobs/create.js';
import type { ShotType, TryonPose } from './engine/tryon-rules.js';
import type { EngineContext, Gender } from './engine/types.js';

const P = schema.modelPoseAssets;
const W = schema.workflowTemplates;

/**
 * The poses the bot may draw for a gender: in the WhatsApp pool, live, Full or
 * Half, and carrying an active try-on workflow. Read fresh on every use, so an
 * admin removing a pose or switching off a workflow takes effect at once.
 */
export async function listPoolPoses(app: FastifyInstance, gender: Gender): Promise<TryonPose[]> {
  const rows = await app.db
    .select({
      id: P.id,
      shotType: P.shotType,
      r2Key: P.r2Key,
      workflowTemplateId: W.id,
      templateVersion: W.version,
    })
    .from(P)
    .innerJoin(W, eq(W.id, P.workflowTemplateId))
    .where(
      and(
        eq(P.whatsappPool, true),
        eq(P.isActive, true),
        isNull(P.deletedAt),
        eq(P.genderSlug, gender),
        inArray(P.shotType, ['full', 'half']),
        eq(W.isActive, true),
        eq(W.workflowType, 'tryon'),
      ),
    )
    .orderBy(P.sortOrder, P.label);
  return rows.map((r) => ({
    id: r.id,
    gender,
    shotType: r.shotType as ShotType,
    r2Key: r.r2Key,
    workflowTemplateId: r.workflowTemplateId,
    templateVersion: r.templateVersion ?? null,
  }));
}

/**
 * One direct try-on job per pose (the shape processTryonDirectJob runs: garment
 * as upperGarmentKey, the pose image as params.personKey), all under one run id
 * that is also the jobs' catalogueId, plus the messaging_runs row delivery reads.
 *
 * Each job is charged and enqueued on its own (createDevJobCore), so when the
 * balance or the queue gives out partway the earlier jobs stand and only they
 * are recorded; `created < requested` tells the caller. Nothing created means
 * the first error is rethrown (INSUFFICIENT_CREDITS reaches the engine as such).
 * Keyed on the Meta message id like createRun, so a redelivered webhook cannot
 * start a second run.
 */
export async function createTryonRun(
  app: FastifyInstance,
  ctx: EngineContext,
  input: { garmentKey: string; poses: TryonPose[] },
): Promise<{ runId: string; requested: number; created: number; reason?: string }> {
  if (input.poses.length === 0) throw new AppError('BAD_REQUEST', 400, 'no poses to generate');
  return withIdempotency(app, 'jobs', ctx.userId, `wa:${ctx.messageId}`, async () => {
    await verifyGarmentKey(app, ctx.userId, input.garmentKey);
    const cost = await getTryonCreditCost(app);
    // The seller's own credits, so their watermark entitlement applies (as for the extension).
    const { watermark } = await resolveQueueRouting(app, ctx.userId);
    const runId = randomUUID();
    const jobIds: string[] = [];
    let failure: unknown;
    for (const pose of input.poses) {
      try {
        const { jobId } = await createDevJobCore(app, {
          merchantUserId: ctx.userId,
          apiKeyId: null,
          cost,
          watermark,
          source: JOB_SOURCE.WHATSAPP_TRYON,
          catalogueId: runId,
          buildJobInputs: () => ({
            upperGarmentKey: input.garmentKey,
            params: {
              personKey: pose.r2Key,
              workflowTemplateId: pose.workflowTemplateId,
              dispatchTemplateVersion: pose.templateVersion,
            },
          }),
        });
        jobIds.push(jobId);
      } catch (err) {
        failure = err;
        break;
      }
    }
    if (jobIds.length === 0) throw failure;
    await app.db
      .insert(schema.messagingRuns)
      .values({
        catalogueId: runId,
        messagingAccountId: ctx.accountId,
        userId: ctx.userId,
        jobIds,
      })
      .onConflictDoNothing();
    return {
      runId,
      requested: input.poses.length,
      created: jobIds.length,
      reason:
        failure instanceof AppError ? failure.message : failure ? 'a temporary problem' : undefined,
    };
  });
}
