import { schema } from '@aivastra/db';
import { CreateTryOnJobRequest } from '@aivastra/types';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { withIdempotency } from '../../lib/idempotency.js';
import {
  createJob,
  resolveTryonPlan,
  updateLastUsedPosePreset,
  verifyGarmentKey,
} from '../jobs/create.js';
import type { EngineContext, Quote, TryonBody } from './engine/types.js';

/**
 * Prices a run exactly as /v1/jobs/tryon would charge it, without charging:
 * the same Zod parse the route runs, the same ownership check createJob runs,
 * then resolveTryonPlan (read-only). Throws the same AppErrors createJob would.
 */
export async function quoteRun(
  app: FastifyInstance,
  userId: string,
  raw: TryonBody,
): Promise<Quote> {
  const body = CreateTryOnJobRequest.parse(raw);
  const key = body.inputs.upperGarmentKey as string;
  await verifyGarmentKey(app, userId, key);
  const plan = await resolveTryonPlan(app, userId, body, { resolvedUpperGarmentKey: key });
  const [credits] = await app.db
    .select({ balance: schema.userCredits.balance })
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return {
    images: plan.looks.length,
    perImage: plan.cost,
    total: plan.cost * plan.looks.length,
    balance: credits?.balance ?? 0,
  };
}

/**
 * The /v1/jobs/tryon route, in process: same parse, same idempotency namespace
 * (keyed on the Meta message id of the last pick, so a redelivered webhook
 * cannot create a second run), same last-used pose tracking. Then records the
 * run so results can find their way back to the chat.
 */
export async function createRun(
  app: FastifyInstance,
  ctx: EngineContext,
  raw: TryonBody,
): Promise<{ runId: string; images: number }> {
  const body = CreateTryOnJobRequest.parse(raw);
  const result = await withIdempotency(app, 'jobs', ctx.userId, `wa:${ctx.messageId}`, () =>
    createJob(app, ctx.userId, body),
  );
  await updateLastUsedPosePreset(
    app,
    ctx.userId,
    result.gender,
    result.garmentTypeId,
    result.poseIds,
  );
  await app.db
    .insert(schema.messagingRuns)
    .values({
      catalogueId: result.catalogueId,
      messagingAccountId: ctx.accountId,
      userId: ctx.userId,
      jobIds: result.jobIds,
    })
    // A replayed pick returns the same catalogueId from the idempotency cache.
    .onConflictDoNothing();
  return { runId: result.catalogueId, images: result.jobIds.length };
}

export async function runProgress(
  app: FastifyInstance,
  runId: string,
): Promise<{ finished: number; total: number }> {
  const [run] = await app.db
    .select({ jobIds: schema.messagingRuns.jobIds })
    .from(schema.messagingRuns)
    .where(eq(schema.messagingRuns.catalogueId, runId));
  if (!run) return { finished: 0, total: 0 };
  const done = await app.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        inArray(schema.jobs.id, run.jobIds),
        // CANCELLED joins COMPLETED/FAILED: the cancel route's terminal set
        // (jobs/routes.ts) lists all three, so a cancelled image counts as done.
        or(
          eq(schema.jobs.status, 'COMPLETED'),
          eq(schema.jobs.status, 'FAILED'),
          eq(schema.jobs.status, 'CANCELLED'),
        ),
      ),
    );
  return { finished: done.length, total: run.jobIds.length };
}
