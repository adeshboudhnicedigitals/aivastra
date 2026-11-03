import { createHash } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { comfyRequestDuration } from '@aivastra/observability';
import { isNotFoundError, keys, type StorageProvider } from '@aivastra/storage';
import { WORKER_POOL } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { downloadOutputImage, fetchHistory, uploadImageToComfy } from '../comfyui/client.js';
import { assertNever, getCompletedHistory, waitForCompletion } from '../comfyui/progress.js';
import {
  logSelection,
  observeCompletion,
  settlePerformanceSample,
} from '../perf/observe-completion.js';
import { performanceKey as getPerformanceKey } from '../perf/performance-key.js';
import { releaseReservation, reserveWorker } from '../worker/reserve.js';
import { selectWorker } from '../worker/selector.js';
import { resolveWorkflowTemplateVersion } from '../workflow/resolve-template-version.js';
import type { OwnerToken } from './ownership.js';
import { beginProcessing } from './start.js';
import { submitRecordedPhase } from './submission.js';

export interface GarmentExtractPhaseConfig {
  db: DB;
  redis: Redis;
  /** SSE publisher for the PREPROCESSING status change made when the first worker is reserved. */
  pub: Redis;
  comfyRedis: Redis;
  comfyPollIntervalMs?: number;
  storage: StorageProvider;
  /** Owner of the paid job this phase runs inside; its intent insert checks it. */
  owner?: OwnerToken;
  uncertainCheckMs?: number;
  /** Follower poll cadence / ceiling while another job extracts the same garment. Test seams. */
  extractFollowerPollMs?: number;
  extractFollowerMaxWaitMs?: number;
}
export interface GarmentExtractPhaseParams {
  jobId: string;
  garmentKey: string;
  garmentExtractWorkflowTemplateId: string;
  /** Version snapshotted at job creation, so an admin replace mid-queue can't change the graph. */
  templateVersion: number | null;
  jobLog: Logger;
  jobType: string | null;
}

// `no_worker` is capacity, not failure: the caller requeues (or terminates past
// MAX_QUEUE_WAIT_MS) without touching `attempts`, exactly like its own main claim.
export type GarmentExtractPhaseResult =
  | { status: 'completed'; key: string }
  | { status: 'no_worker' }
  | { status: 'cleanup_failed' };

// A request with N poses is N jobs over the same garment image, and the extraction depends
// only on that image and the workflow — never the pose. So the first job extracts and the
// rest reuse its result, instead of paying N identical (and, being generative, slightly
// different) GPU runs. Redis holds a pointer to the finished image and a short lock so
// concurrent siblings wait for the leader instead of all extracting at once.
const CACHE_TTL_SEC = 24 * 60 * 60;
// Longer than the 300s Comfy timeout in this phase plus a worker wait, so a live leader keeps
// its lock; a crashed one is taken over when it expires.
const LOCK_TTL_SEC = 10 * 60;
const FOLLOWER_POLL_MS = 2_000;
const FOLLOWER_MAX_WAIT_MS = 8 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The workflow id + version are in the id, so replacing the extraction workflow never serves
// an image produced by the old graph.
export function garmentExtractCacheId(
  garmentKey: string,
  templateId: string,
  templateVersion: number,
): string {
  return createHash('sha256')
    .update(`${garmentKey}|${templateId}|${templateVersion}`)
    .digest('hex');
}
export const garmentExtractCacheKey = (cacheId: string) => `garment-extract:cache:${cacheId}`;
export const garmentExtractLockKey = (cacheId: string) => `garment-extract:lock:${cacheId}`;

interface ExtractPointer {
  key: string;
  jobId: string;
  workerId: string;
}

// Compare-and-delete: never release a lock that expired and was re-taken by another job.
const RELEASE_LOCK_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Pre-step for garment types whose uploads arrive worn on a mannequin/person: runs the
 * admin-configured garment_extract workflow (one image in, one ghost-mannequin image out)
 * and hands back the R2 key the main workflow should use as the upper garment instead.
 * Runs inside the paid job — one charge, one refund path — unlike the saree mannequin step.
 * Sibling jobs over the same garment share one extraction (see the cache note above).
 */
export async function runGarmentExtractPhase(
  cfg: GarmentExtractPhaseConfig,
  params: GarmentExtractPhaseParams,
): Promise<GarmentExtractPhaseResult> {
  const { db, redis, storage } = cfg;
  const { jobId, garmentKey, garmentExtractWorkflowTemplateId, templateVersion, jobLog, jobType } =
    params;

  // Written by one PutObject after the image has fully downloaded, so its existence IS
  // the checkpoint: a job that finished this phase but found no worker for its main
  // claim is requeued, and without this every requeue would repeat the GPU work.
  // Missing (or any HEAD error) falls through to regenerate.
  const intermediateKey = keys.garmentExtractIntermediate(jobId);
  try {
    await storage.headObject(intermediateKey);
    jobLog.info({ intermediateKey }, 'garment-extract intermediate exists — skipping GPU phase');
    return { status: 'completed', key: intermediateKey };
  } catch (err) {
    if (!isNotFoundError(err)) {
      jobLog.warn({ err }, 'garment-extract intermediate HEAD failed — regenerating');
    }
  }

  const template = await resolveWorkflowTemplateVersion(
    db,
    garmentExtractWorkflowTemplateId,
    templateVersion,
  );
  if (!template) throw new Error('GARMENT_EXTRACT_WORKFLOW_NOT_FOUND');
  // The id comes from the job's params snapshot; never run a graph of another type.
  if (template.workflowType !== 'garment_extract') {
    throw new Error('GARMENT_EXTRACT_WORKFLOW_WRONG_TYPE');
  }
  const { tryonGarmentNodeId: inputNodeId, tryonOutputNodeId: outputNodeId } = template;
  if (!inputNodeId || !outputNodeId) throw new Error('GARMENT_EXTRACT_NODES_NOT_CONFIGURED');

  const cacheId = garmentExtractCacheId(
    garmentKey,
    template.id,
    template.performanceArchivedVersion ?? template.version,
  );
  const cacheKey = garmentExtractCacheKey(cacheId);
  const lockKey = garmentExtractLockKey(cacheId);

  // A sibling's finished image becomes THIS job's own checkpoint (copied, not pointed at), so
  // retries, the admin Stages links and the sibling's later deletion all behave as if this job
  // had extracted it itself. Any miss — no pointer, object gone, Redis hiccup — just means
  // "extract it yourself"; the cache can never fail a job.
  async function tryReuse(): Promise<GarmentExtractPhaseResult | null> {
    try {
      const raw = await redis.get(cacheKey);
      if (!raw) return null;
      const pointer = JSON.parse(raw) as Partial<ExtractPointer>;
      if (!pointer.key) return null;
      const bytes = await storage.getObject(pointer.key);
      await storage.putObject(intermediateKey, bytes, 'image/png');
      await db.insert(schema.jobEvents).values({
        jobId,
        eventType: 'GARMENT_EXTRACT_REUSED',
        payload: {
          sourceJobId: pointer.jobId ?? null,
          workerId: pointer.workerId ?? null,
          sourceKey: pointer.key,
        },
      });
      jobLog.info(
        { sourceJobId: pointer.jobId },
        'reused a sibling job’s garment extraction — skipping GPU phase',
      );
      return { status: 'completed', key: intermediateKey };
    } catch (err) {
      if (!isNotFoundError(err)) jobLog.warn({ err }, 'garment-extract cache read failed');
      return null;
    }
  }

  const alreadyExtracted = await tryReuse();
  if (alreadyExtracted) return alreadyExtracted;

  // Leader election: first job to SET NX extracts; the others poll for its result. The wait
  // holds no GPU worker (selectWorker comes after), and is bounded so a stuck leader degrades
  // to the old behaviour — every job extracting for itself — instead of stalling siblings.
  const pollMs = cfg.extractFollowerPollMs ?? FOLLOWER_POLL_MS;
  const deadline = Date.now() + (cfg.extractFollowerMaxWaitMs ?? FOLLOWER_MAX_WAIT_MS);
  let isLeader = false;
  for (;;) {
    let acquired = false;
    try {
      acquired = (await redis.set(lockKey, jobId, 'EX', LOCK_TTL_SEC, 'NX')) === 'OK';
    } catch (err) {
      jobLog.warn({ err }, 'garment-extract lock unavailable — extracting without sharing');
      break;
    }
    if (acquired) {
      isLeader = true;
      // The leader before us may have finished between our cache read and this lock.
      const justFinished = await tryReuse();
      if (justFinished) {
        await releaseLock();
        return justFinished;
      }
      break;
    }
    if (Date.now() >= deadline) {
      jobLog.warn('timed out waiting for a sibling’s garment extraction — extracting here');
      break;
    }
    await sleep(pollMs);
    const reused = await tryReuse();
    if (reused) return reused;
  }

  async function releaseLock(): Promise<void> {
    await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, jobId).catch((err) => {
      // Expires on its own after LOCK_TTL_SEC; siblings just wait a little longer.
      jobLog.warn({ err }, 'garment-extract lock release failed');
    });
  }

  try {
    return await extractOnGpu();
  } finally {
    // Released on every exit — success, no_worker, cleanup_failed, throw — so a sibling can
    // take over immediately rather than waiting out the TTL.
    if (isLeader) await releaseLock();
  }

  async function extractOnGpu(): Promise<GarmentExtractPhaseResult> {
    const performanceKey = getPerformanceKey(template as NonNullable<typeof template>);
    const { owner } = cfg;
    const reservation = await reserveWorker({
      db,
      redis,
      owner,
      jobId,
      phase: 'garment_extract',
      log: jobLog,
      select: (token) =>
        selectWorker(redis, WORKER_POOL.SAREE, performanceKey, { jobId, log: jobLog, token }),
      // The job leaves QUEUED when this first worker is reserved, not when it was admitted.
      onBound: owner ? () => beginProcessing({ db, pub: cfg.pub, owner, log: jobLog }) : undefined,
    });
    if (!reservation) return { status: 'no_worker' };
    const w = reservation.worker;

    try {
      const bytes = await storage.getObject(garmentKey);
      const rawExt = garmentKey.split('.').pop()?.toLowerCase() ?? '';
      const ext = rawExt === 'png' ? 'png' : rawExt === 'webp' ? 'webp' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      jobLog.info('uploading garment-extract input to ComfyUI');
      const garmentFile = await uploadImageToComfy(
        w.url,
        w.apiKey,
        bytes,
        `extract_garment_${jobId}_${reservation.attemptId}.${ext}`,
        mime,
        jobLog,
      );
      const workflow = structuredClone(template?.jsonContent) as Record<
        string,
        { inputs?: Record<string, unknown> }
      >;
      const inputNode = workflow[inputNodeId as string]?.inputs;
      if (!inputNode) throw new Error('GARMENT_EXTRACT_INPUT_NODE_MISSING');
      inputNode.image = garmentFile;

      const comfyStartedAt = Date.now();
      const {
        promptId,
        clientId: clientUuid,
        attemptId,
      } = await submitRecordedPhase({
        attemptId: reservation.attemptId,
        db,
        owner: cfg.owner,
        jobId,
        phase: 'garment_extract',
        worker: w,
        prompt: workflow,
        log: jobLog,
        contract: {
          kind: 'in_job_garment_extract',
          workflowTemplateId: garmentExtractWorkflowTemplateId,
          outputNodeId,
          inputs: { garmentKey, garmentFile },
          continuation: { intermediateKey },
          timeoutMs: 300_000,
        },
      });
      jobLog.info({ promptId }, 'garment-extract prompt submitted');
      await db.insert(schema.jobEvents).values({
        jobId,
        eventType: 'COMFY_DISPATCH',
        payload: {
          promptId,
          attemptId,
          clientId: clientUuid,
          workerId: w.id,
          workerUrl: w.url,
          workflowTemplateId: garmentExtractWorkflowTemplateId,
          phase: 'garment_extract',
          inputs: { garmentKey, garmentFile },
          prompt: workflow,
        },
      });
      logSelection(cfg.comfyRedis, w, WORKER_POOL.SAREE, performanceKey ?? '', jobLog);
      const completion = await observeCompletion(
        cfg.comfyRedis,
        w,
        WORKER_POOL.SAREE,
        performanceKey ?? '',
        workflow,
        jobLog,
        (totalNodeCount) =>
          waitForCompletion(
            w.url,
            w.apiKey,
            clientUuid,
            promptId,
            300_000,
            (update) => jobLog.debug(update, 'comfyui progress'),
            {
              info: jobLog.info.bind(jobLog),
              debug: jobLog.debug.bind(jobLog),
              error: jobLog.error.bind(jobLog),
            },
            undefined,
            { comfyRedis: cfg.comfyRedis, workerId: w.id, jobId },
            totalNodeCount,
            cfg.comfyPollIntervalMs,
          ),
      );
      switch (completion.status) {
        case 'completed':
          break;
        case 'queue_cleanup_failed':
          return { status: 'cleanup_failed' };
        default:
          return assertNever(completion);
      }
      // Recorded on the job like the mannequin phase; the main phase overwrites it with
      // its own duration, so this only shows for a job that dies between the two.
      const comfyMs = Date.now() - comfyStartedAt;
      comfyRequestDuration.observe({ job_type: jobType ?? 'unknown' }, comfyMs / 1000);
      await db
        .update(schema.jobs)
        .set({ comfyDurationMs: Math.round(comfyMs) })
        .where(eq(schema.jobs.id, jobId));
      const [firstImage] = await fetchHistory(
        w.url,
        w.apiKey,
        promptId,
        jobLog,
        outputNodeId as string,
        getCompletedHistory(completion),
      );
      if (!firstImage)
        throw new Error('ComfyUI returned no output images for garment-extract phase');
      const imageBytes = await downloadOutputImage(
        w.url,
        w.apiKey,
        firstImage.filename,
        firstImage.subfolder,
      );
      await storage.putObject(intermediateKey, imageBytes, 'image/png');
      await db
        .update(schema.executionAttempts)
        .set({ state: 'SUCCEEDED', updatedAt: new Date(), resolvedAt: new Date() })
        .where(eq(schema.executionAttempts.id, attemptId));
      settlePerformanceSample(w, 'success');
      // Publish for siblings only after the image is durably stored. Best effort: a failure
      // here costs them a re-extraction, never this job its result.
      await redis
        .set(
          cacheKey,
          JSON.stringify({ key: intermediateKey, jobId, workerId: w.id } satisfies ExtractPointer),
          'EX',
          CACHE_TTL_SEC,
        )
        .catch((err) => jobLog.warn({ err }, 'garment-extract cache write failed'));
      jobLog.info({ intermediateKey }, 'garment-extract phase complete');
      return { status: 'completed', key: intermediateKey };
    } catch (err) {
      settlePerformanceSample(w, 'workflow_failure');
      throw err;
    } finally {
      await releaseReservation(
        { db, redis, uncertainCheckMs: cfg.uncertainCheckMs ?? 90_000, log: jobLog },
        reservation,
      );
    }
  }
}
