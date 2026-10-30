import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { downloadOutputImage, fetchHistory } from '../comfyui/client.js';
import { getCompletedHistory, JobCancelledError, waitForCompletion } from '../comfyui/progress.js';
import {
  findPromptByClientId,
  findPromptById,
  type PromptSearchResult,
} from '../comfyui/reconcile.js';
import { getImageCompressionConfig } from '../config/image-compression.js';
import {
  adoptWorkerReservation,
  REGISTRY_KEY,
  RESERVATIONS_KEY,
  releaseWorker,
  reservationToken,
} from '../worker/registry.js';
import {
  deadlinePassed,
  ensureDeadline,
  markResolved,
  reconcileReservation,
  recordDiscoveredReceipt,
} from '../worker/reservation-reconciler.js';
import { releaseReservation } from '../worker/reserve.js';
import { finalizeComparisonOutput } from '../workflow/comparison-finalize.js';
import { finalizeOutput } from '../workflow/finalize.js';
import { announceWidgetCompleted, finalizeWidgetOutput } from '../workflow/widget-finalize.js';
import type { OwnerToken } from './ownership.js';
import type { ProcessorConfig } from './processor.js';

/**
 * Adoption: a replacement dispatcher takes a paid job whose prompt may still be running on a
 * worker and finishes it, instead of failing it as a crash. It never POSTs a prompt and never
 * counts a failure on plain adoption; `jobs.attempts` moves only through the same counted
 * failure handler an uninterrupted run would have used, and only when the prompt is shown to
 * have failed, vanished, or never reached the worker.
 */

export type AdoptionOutcome =
  /** Nothing is running remotely: the caller restarts the normal flow under the new owner. */
  | { kind: 'continue' }
  /** Finished here; the caller ACKs. `completed` is false when the job was already terminal. */
  | { kind: 'finished'; completed: boolean }
  /** A per-kind failure handler ran and ACKed (or re-enqueued) the message. */
  | { kind: 'failed' }
  /** Cannot be decided yet; leave the message pending for the next delivery. */
  | { kind: 'pending'; reason: string };

export interface AdoptionJob {
  id: string;
  status: string;
  userId: string | null;
  merchantId: string | null;
  shopifyStoreId: string | null;
  source: string | null;
  watermark: boolean;
}

export interface AdoptionHooks {
  /** The kind-specific counted failure (handleFailure / markWidgetFailed / markShopifyFailed). */
  fail: (errorCode: string) => Promise<void>;
  /** The user cancelled while the prompt ran. */
  cancelled: () => Promise<void>;
}

export interface AdoptArgs {
  cfg: ProcessorConfig & { owner: OwnerToken };
  job: AdoptionJob;
  log: Logger;
  hooks: AdoptionHooks;
  /** Poll period while a receipt-less attempt is searched for (tests shrink it). */
  searchPollMs?: number;
}

interface Contract {
  kind?: string;
  outputNodeId?: string | null;
  watermark?: boolean;
  timeoutMs?: number;
  finalizer?: 'standard' | 'widget';
  compressionSource?: string | null;
}

type Attempt = typeof schema.executionAttempts.$inferSelect;

const DEFAULT_SEARCH_POLL_MS = 3_000;
const MIN_WAIT_MS = 1_000;

async function loadActiveAttempt(db: DB, jobId: string): Promise<Attempt | undefined> {
  const [row] = await db
    .select({ attempt: schema.executionAttempts })
    .from(schema.dispatcherJobControl)
    .innerJoin(
      schema.executionAttempts,
      eq(schema.executionAttempts.id, schema.dispatcherJobControl.activeAttemptId),
    )
    .where(eq(schema.dispatcherJobControl.jobId, jobId));
  return row?.attempt;
}

/** When the persisted intent committed: the start of the prompt's own time budget. */
async function submitStartedAt(db: DB, attempt: Attempt): Promise<number> {
  const [row] = await db
    .select({ at: schema.jobEvents.createdAt })
    .from(schema.jobEvents)
    .where(
      and(
        eq(schema.jobEvents.jobId, attempt.jobId ?? ''),
        eq(schema.jobEvents.eventType, 'COMFY_SUBMIT_STARTED'),
        sql`${schema.jobEvents.payload}->>'attemptId' = ${attempt.id}`,
      ),
    )
    .orderBy(desc(schema.jobEvents.createdAt))
    .limit(1);
  return (row?.at ?? attempt.createdAt).getTime();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function adoptComfyJob(args: AdoptArgs): Promise<AdoptionOutcome> {
  const { cfg, job, hooks } = args;
  const { db, redis, owner } = cfg;
  const attempt = await loadActiveAttempt(db, job.id);

  // A job in flight with no attempt record at all predates attempt tracking: nothing says
  // whether a prompt was ever sent, so restarting could run it twice. It keeps the legacy
  // policy, a counted failure, and is the only case that does.
  if (!attempt && ['GENERATING', 'UPLOADING'].includes(job.status)) {
    const [any] = await db
      .select({ id: schema.executionAttempts.id })
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.jobId, job.id))
      .limit(1);
    if (!any) {
      args.log.warn(
        { status: job.status },
        'in-flight job has no attempt record — counted failure',
      );
      await hooks.fail('DISPATCHER_CRASH');
      return { kind: 'failed' };
    }
  }

  // Nothing could be running: no attempt, one that never submitted, or one already settled by
  // its own outcome. The mannequin phase is restarted too; its intermediate checkpoint is reused
  // from storage, so the restart only repeats work that was not saved.
  if (
    !attempt ||
    attempt.phase !== 'main' ||
    !['SUBMITTING', 'ACCEPTED', 'OUTPUT_READY'].includes(attempt.state) ||
    !attempt.workerId
  ) {
    // The dead owner may still hold a worker for an attempt that never submitted (or whose
    // prompt already ended). Free it on the same evidence the reconciler would use, so the
    // restarted flow is not left waiting for the next tick; a still-running prompt stays held.
    if (attempt?.workerId) {
      const held = await redis.hget(RESERVATIONS_KEY, attempt.workerId);
      if (held?.endsWith(`:${attempt.id}`))
        await reconcileReservation(
          { db, redis, log: args.log, uncertainCheckMs: cfg.uncertainCheckMs ?? 90_000 },
          attempt.workerId,
          held,
          'reconciler',
        );
    }
    return { kind: 'continue' };
  }

  const contract = (attempt.contract ?? {}) as Contract;
  const attemptLog = args.log.child({ stage: 'adoption', attemptId: attempt.id });
  const token = reservationToken({
    session: owner.session,
    generation: owner.generation,
    attemptId: attempt.id,
  });

  const raw = await redis.hget(REGISTRY_KEY, attempt.workerId);
  const entry = raw ? (JSON.parse(raw) as { url?: string; apiKey?: string }) : undefined;
  if (!entry?.url || !entry.apiKey)
    return { kind: 'pending', reason: 'worker is not in the registry' };
  // A re-pointed worker is never sent the old attempt's lookups.
  if (attempt.workerUrl && attempt.workerUrl.replace(/\/$/, '') !== entry.url.replace(/\/$/, ''))
    return { kind: 'pending', reason: 'worker url changed since the attempt' };
  const worker = { url: entry.url, apiKey: entry.apiKey };

  const adopted = await adoptWorkerReservation(redis, attempt.workerId, attempt.id, token);
  if (adopted === 'conflict')
    return { kind: 'pending', reason: 'the worker is held by a different attempt' };
  await db.insert(schema.jobEvents).values({
    jobId: job.id,
    eventType: 'COMFY_ADOPT',
    payload: {
      attemptId: attempt.id,
      clientId: attempt.clientId,
      workerId: attempt.workerId,
      promptKnown: !!attempt.promptId,
      reservation: adopted,
      session: owner.session,
      generation: owner.generation,
    },
  });
  attemptLog.info({ promptKnown: !!attempt.promptId, reservation: adopted }, 'adopting job');

  const reservation = {
    worker: {
      id: attempt.workerId,
      url: worker.url,
      apiKey: worker.apiKey,
    } as Parameters<typeof releaseReservation>[1]['worker'],
    attemptId: attempt.id,
    clientId: attempt.clientId,
    token,
  };
  const releaseOwn = () =>
    releaseReservation(
      { db, redis, uncertainCheckMs: cfg.uncertainCheckMs ?? 90_000, log: attemptLog },
      reservation,
    );

  const timeoutMs = contract.timeoutMs ?? 300_000;
  const budgetEndsAt = (await submitStartedAt(db, attempt)) + timeoutMs;

  // 1. A receipt-less attempt: the POST may have been accepted with its reply lost.
  let promptId = attempt.promptId;
  if (!promptId) {
    const found = await searchForReceipt(args, attempt, worker);
    if (found.kind !== 'found') return found.outcome;
    promptId = found.promptId;
  }

  // 2. A known prompt: wait for it if it runs, finalize it if it finished.
  return finishKnownPrompt({
    args,
    attempt,
    contract,
    worker,
    promptId,
    budgetEndsAt,
    releaseOwn,
    hooks,
    log: attemptLog,
  });
}

type SearchResult =
  | { kind: 'found'; promptId: string }
  | { kind: 'stop'; outcome: AdoptionOutcome };

/**
 * Searches the worker for the attempt's client id until the persisted deadline. The deadline is
 * written once (database time) and read back on every restart, so repeated crashes never
 * extend it.
 */
async function searchForReceipt(
  args: AdoptArgs,
  attempt: Attempt,
  worker: { url: string; apiKey: string },
): Promise<SearchResult> {
  const { cfg, job, hooks } = args;
  const { db, redis } = cfg;
  const uncertainCheckMs = cfg.uncertainCheckMs ?? 90_000;
  const recCfg = { db, redis, log: args.log, uncertainCheckMs };
  const deadline = await ensureDeadline(recCfg, attempt.id);
  const pollMs = args.searchPollMs ?? DEFAULT_SEARCH_POLL_MS;

  for (;;) {
    const observed: PromptSearchResult = await findPromptByClientId(
      worker,
      attempt.clientId,
      deadline,
    );
    if (observed.kind === 'found') {
      const recorded = await recordDiscoveredReceipt(
        recCfg,
        attempt,
        observed.promptId,
        observed.observation,
      );
      if (recorded === 'conflict' || recorded === 'stale')
        return stop({ kind: 'pending', reason: `receipt ${recorded}` });
      return { kind: 'found', promptId: observed.promptId };
    }
    if (observed.kind === 'not_found' && (await deadlinePassed(db, attempt.id))) {
      // The complete queue-then-history read made after the deadline shows the worker never
      // took the prompt. Only now is a counted retry safe.
      await markResolved(db, attempt, attempt.workerId ?? '', 'client_absent_after_deadline');
      await db
        .update(schema.executionAttempts)
        .set({ state: 'UNKNOWN_RETRIED', updatedAt: new Date() })
        .where(
          and(
            eq(schema.executionAttempts.id, attempt.id),
            eq(schema.executionAttempts.state, 'SUBMITTING'),
          ),
        );
      await releaseWorker(
        redis,
        attempt.workerId ?? '',
        reservationToken({
          session: cfg.owner.session,
          generation: cfg.owner.generation,
          attemptId: attempt.id,
        }),
        args.log,
      );
      await hooks.fail('UNCERTAIN_SUBMISSION_NOT_ACCEPTED');
      return stop({ kind: 'failed' });
    }
    if (await deadlinePassed(db, attempt.id))
      // Past the deadline but the worker cannot be read: fail closed, retry later.
      return stop({ kind: 'pending', reason: `search unresolved: ${observed.kind}` });
    if (await cfg.redis.exists(`job:cancel:${job.id}`)) {
      await hooks.cancelled();
      return stop({ kind: 'finished', completed: false });
    }
    await sleep(pollMs);
  }

  function stop(outcome: AdoptionOutcome): SearchResult {
    return { kind: 'stop', outcome };
  }
}

async function finishKnownPrompt(a: {
  args: AdoptArgs;
  attempt: Attempt;
  contract: Contract;
  worker: { url: string; apiKey: string };
  promptId: string;
  budgetEndsAt: number;
  releaseOwn: () => Promise<unknown>;
  hooks: AdoptionHooks;
  log: Logger;
}): Promise<AdoptionOutcome> {
  const { args, attempt, contract, worker, promptId, budgetEndsAt, hooks, log } = a;
  const { cfg, job } = args;
  const { db, redis } = cfg;
  const pollMs = args.searchPollMs ?? DEFAULT_SEARCH_POLL_MS;

  try {
    let observed = await findPromptById(worker, promptId);
    // An unreadable worker is retried until the prompt's own time budget ends.
    while (observed.kind === 'unavailable' && Date.now() < budgetEndsAt) {
      await sleep(pollMs);
      observed = await findPromptById(worker, promptId);
    }
    if (observed.kind === 'unavailable')
      return { kind: 'pending', reason: `prompt unverifiable: ${observed.reason}` };
    if (observed.kind === 'not_found') {
      await hooks.fail('PROMPT_LOST');
      return { kind: 'failed' };
    }
    if (observed.observation === 'failed') {
      await hooks.fail('WORKER_PROMPT_FAILED');
      return { kind: 'failed' };
    }

    let history: ReturnType<typeof getCompletedHistory>;
    if (observed.observation === 'queued' || observed.observation === 'running') {
      const completion = await waitForCompletion(
        worker.url,
        worker.apiKey,
        attempt.clientId,
        promptId,
        Math.max(MIN_WAIT_MS, budgetEndsAt - Date.now()),
        undefined,
        {
          info: log.info.bind(log),
          debug: log.debug.bind(log),
          error: log.error.bind(log),
          warn: log.warn.bind(log),
        },
        async () => (await redis.exists(`job:cancel:${job.id}`)) === 1,
        { comfyRedis: cfg.comfyRedis, workerId: attempt.workerId ?? '' },
        0,
        cfg.comfyPollIntervalMs,
      );
      if (completion.status !== 'completed') {
        await hooks.fail('QUEUE_CLEANUP_FAILED');
        return { kind: 'failed' };
      }
      history = getCompletedHistory(completion);
    }

    const images = await fetchHistory(
      worker.url,
      worker.apiKey,
      promptId,
      log,
      contract.outputNodeId ?? undefined,
      history,
    );
    const [first] = images;
    if (!first) {
      await hooks.fail('ComfyUI returned no output images');
      return { kind: 'failed' };
    }
    const imageBytes = await downloadOutputImage(
      worker.url,
      worker.apiKey,
      first.filename,
      first.subfolder,
    );
    const compression = await getImageCompressionConfig(
      redis,
      contract.compressionSource ?? job.source,
    );

    if (contract.finalizer === 'widget') {
      const merchantId = job.merchantId;
      if (!merchantId) throw new Error('widget contract on a job without a merchant');
      const { completed, resultKey } = await finalizeWidgetOutput({
        owner: cfg.owner,
        attemptId: attempt.id,
        imageBytes,
        jobId: job.id,
        compression,
        db,
        pub: cfg.pub,
        storage: cfg.storage,
        jobLog: log,
      });
      if (completed)
        await announceWidgetCompleted(cfg.pub, redis, { jobId: job.id, merchantId, resultKey });
      return { kind: 'finished', completed };
    }

    const finalization = {
      owner: cfg.owner,
      attemptId: attempt.id,
      imageBytes,
      jobId: job.id,
      userId: job.shopifyStoreId ? '' : (job.userId ?? ''),
      shopifyStoreId: job.shopifyStoreId ?? undefined,
      jobWatermark: contract.watermark ?? job.watermark,
      compression,
      db,
      pub: cfg.pub,
      storage: cfg.storage,
      jobLog: log,
    };
    const { completed } =
      job.source === 'comparison'
        ? await finalizeComparisonOutput(finalization, cfg.withAdvisoryLock)
        : await finalizeOutput(finalization);
    return { kind: 'finished', completed };
  } catch (err) {
    if (err instanceof JobCancelledError) {
      await hooks.cancelled();
      return { kind: 'finished', completed: false };
    }
    throw err;
  } finally {
    // Frees the worker only on evidence; a still-running prompt stays held for the reconciler.
    await a.releaseOwn();
  }
}
