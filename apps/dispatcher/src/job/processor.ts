import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, type DB } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import type { StorageProvider } from '@aivastra/storage';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { transitionJob } from './state.js';
import { selectWorker } from '../worker/selector.js';
import { setWorkerStatus } from '../worker/registry.js';
import { patchWorkflow } from '../workflow/patcher.js';
import { submitPrompt, fetchHistory, downloadOutputImage, uploadImageToComfy } from '../comfyui/client.js';
import { waitForCompletion } from '../comfyui/progress.js';

const MAX_ATTEMPTS = 2;

export interface ProcessorConfig {
  db: DB;
  redis: Redis;
  pub: Redis;
  storage: StorageProvider;
  s3: S3Client;
  r2Bucket: string;
  workerApiKey: string;
  log: Logger;
}

export async function processJob(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket, workerApiKey, log } = cfg;
  const jobLog = log.child({ jobId, userId });

  // 1. Load job + inputs
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) { jobLog.error('job not found — skipping'); await redis.xack(stream, 'dispatcher-cg', messageId); return; }
  if (job.status !== 'QUEUED') {
    jobLog.warn({ status: job.status }, 'job not QUEUED — skipping');
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }

  const [inputs] = await db.select().from(schema.jobInputs).where(eq(schema.jobInputs.jobId, jobId));
  if (!inputs) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_INPUTS', jobLog);
    return;
  }

  // 2. Resolve face / background / pose IDs → R2 keys
  const [faceRow] = await db.select({ r2Key: schema.modelFaces.r2Key }).from(schema.modelFaces).where(eq(schema.modelFaces.id, inputs.faceId));
  const [bgRow] = await db.select({ r2Key: schema.modelBackgrounds.r2Key }).from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, inputs.backgroundId));
  const [poseRow] = await db.select({
    r2Key: schema.modelPoses.r2Key,
    faceSideR2Key: schema.modelPoses.faceSideR2Key,
    workflowTemplate: schema.modelPoses.workflowTemplate,
    promptFacePhase: schema.modelPoses.promptFacePhase,
    promptGarmentPhase: schema.modelPoses.promptGarmentPhase,
  }).from(schema.modelPoses).where(eq(schema.modelPoses.id, inputs.poseId));

  if (!faceRow || !bgRow || !poseRow) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'CATALOG_NOT_FOUND', jobLog);
    return;
  }

  const bgKey = bgRow.r2Key;
  const poseKey = poseRow.r2Key;
  // Use pose's side-face key for ComfyUI; fall back to display face for legacy poses without it
  const faceSideKey = poseRow.faceSideR2Key ?? faceRow?.r2Key ?? null;
  if (!faceSideKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog);
    return;
  }
  const workflowTemplate = (poseRow.workflowTemplate ?? 'twopiece') as 'twopiece' | 'onepiece' | 'hijab';

  // Resolve optional lower garment catalog ID → R2 key
  let lowerKey: string | null = null;
  if (inputs.lowerCatalogId) {
    const [lowerRow] = await db.select({ r2Key: schema.catalogItems.r2Key }).from(schema.catalogItems).where(eq(schema.catalogItems.id, inputs.lowerCatalogId));
    if (lowerRow) lowerKey = lowerRow.r2Key;
    else jobLog.warn({ lowerCatalogId: inputs.lowerCatalogId }, 'lower garment catalog item not found — skipping');
  }

  // 3. Claim a worker
  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);
  const worker = await selectWorker(redis);
  if (!worker) {
    jobLog.warn('no idle worker — re-enqueuing with backoff');
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    // Wait 10s before re-enqueuing to prevent stream flood when all workers are unhealthy
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed');

  try {
    // 4. Download images from R2, upload to ComfyUI input folder
    async function r2Download(key: string): Promise<Uint8Array> {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 object missing: ${key}`);
      return res.Body.transformToByteArray();
    }

    async function uploadToComfy(key: string, prefix: string): Promise<string> {
      const bytes = await r2Download(key);
      const ext = key.split('.').pop() ?? 'jpg';
      return uploadImageToComfy(w.url, workerApiKey, bytes, `${prefix}_${jobId}.${ext}`, `image/${ext === 'png' ? 'png' : 'jpeg'}`, jobLog);
    }

    jobLog.info('uploading inputs to ComfyUI');
    const uploadTasks: Promise<string>[] = [
      uploadToComfy(inputs.upperGarmentKey, 'garment'),
      uploadToComfy(faceSideKey, 'faceside'),
      uploadToComfy(poseKey, 'pose'),
      uploadToComfy(bgKey, 'bg'),
    ];
    if (lowerKey) uploadTasks.push(uploadToComfy(lowerKey, 'lower'));
    const [upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile] = await Promise.all(uploadTasks);
    jobLog.info({ upperGarmentFile, faceSideFile, poseFile, backgroundFile, lowerGarmentFile }, 'inputs uploaded');

    // 5. Patch workflow template with ComfyUI filenames
    const prompt = patchWorkflow({
      workflowTemplate,
      upperGarmentFile: upperGarmentFile!,
      faceSideFile: faceSideFile!,
      poseFile: poseFile!,
      backgroundFile: backgroundFile!,
      lowerGarmentFile,
      promptFacePhase: poseRow.promptFacePhase ?? undefined,
      promptGarmentPhase: poseRow.promptGarmentPhase ?? undefined,
    });

    // 6. Submit to ComfyUI
    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const { promptId } = await submitPrompt(w.url, workerApiKey, clientUuid, prompt, jobLog);
    jobLog.info({ promptId }, 'prompt submitted to ComfyUI');

    // 7. Wait for completion via WebSocket (5 min max)
    await waitForCompletion(
      w.url, workerApiKey, clientUuid, promptId, 300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );

    // 8. Fetch output metadata + download image
    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, workerApiKey, promptId, jobLog);
    if (!outputImages.length) throw new Error('ComfyUI returned no output images');

    const imageBytes = await downloadOutputImage(
      w.url, workerApiKey, outputImages[0]!.filename,
    );

    // 9. Upload result to R2
    const resultKey = keys.output(jobId);
    await s3.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: resultKey,
      Body: imageBytes,
      ContentType: 'image/png',
    }));

    // 10. Mark COMPLETED
    await transitionJob(db, pub, jobId, userId, 'COMPLETED', { resultKey }, jobLog);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    jobLog.info('job completed successfully');

  } catch (err) {
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog);
  }
}

async function handleFailure(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  log: Logger,
): Promise<void> {
  const { db, redis, pub } = cfg;

  const [current] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!current) return;

  const newAttempts = current.attempts + 1;
  await db.update(schema.jobs).set({ attempts: newAttempts }).where(eq(schema.jobs.id, jobId));

  if (newAttempts >= MAX_ATTEMPTS) {
    // Terminal failure: refund credits (idempotent)
    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      if (existing.some((e) => e.reason === 'JOB_FAIL_REFUND')) return;
      await tx
        .update(schema.userCredits)
        .set({ balance: sql`${schema.userCredits.balance} + ${current.creditsCharged}` })
        .where(eq(schema.userCredits.userId, userId));
      await tx.insert(schema.creditLedger).values({
        userId,
        delta: current.creditsCharged,
        reason: 'JOB_FAIL_REFUND',
        jobId,
      });
    });
    await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode: 'MAX_RETRIES' }, log);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.warn({ jobId, attempts: newAttempts }, 'job FAILED after max retries — credits refunded');
  } else {
    // Re-enqueue for retry
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.info({ jobId, attempts: newAttempts }, `job re-enqueued for retry (attempt ${newAttempts})`);
  }
}

async function markFailed(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  errorCode: string,
  log: Logger,
): Promise<void> {
  const { db, redis, pub } = cfg;
  await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode }, log);
  await redis.xack(stream, 'dispatcher-cg', messageId);
}
