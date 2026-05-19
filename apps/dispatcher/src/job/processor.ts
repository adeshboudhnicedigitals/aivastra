import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { schema, type DB } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import type { StorageProvider } from '@aivastra/storage';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { transitionJob } from './state.js';
import { selectWorker } from '../worker/selector.js';
import { setWorkerStatus } from '../worker/registry.js';
import { patchWorkflow } from '../workflow/patcher.js';
import { submitPrompt, fetchHistory, downloadOutputImage } from '../comfyui/client.js';
import { waitForCompletion } from '../comfyui/progress.js';

const MAX_ATTEMPTS = 2;

export interface ProcessorConfig {
  db: DB;
  redis: Redis;
  pub: Redis;
  storage: StorageProvider;
  s3: S3Client;
  r2Bucket: string;
  cfClientId: string;
  cfClientSecret: string;
  log: Logger;
}

export async function processJob(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
): Promise<void> {
  const { db, redis, pub, storage, s3, r2Bucket, cfClientId, cfClientSecret, log } = cfg;
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

  // 2. Resolve catalog IDs → R2 keys
  const catalogIds = [
    inputs.modelCatalogId,
    inputs.poseCatalogId,
    inputs.backgroundCatalogId,
    inputs.lowerCatalogId,
  ];
  const catalogItems = await db
    .select({ id: schema.catalogItems.id, r2Key: schema.catalogItems.r2Key })
    .from(schema.catalogItems)
    .where(inArray(schema.catalogItems.id, catalogIds));
  const r2KeyMap = new Map(catalogItems.map((c) => [c.id, c.r2Key]));

  const modelKey = r2KeyMap.get(inputs.modelCatalogId);
  const poseKey = r2KeyMap.get(inputs.poseCatalogId);
  const bgKey = r2KeyMap.get(inputs.backgroundCatalogId);
  const lowerKey = r2KeyMap.get(inputs.lowerCatalogId);
  if (!modelKey || !poseKey || !bgKey || !lowerKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'CATALOG_NOT_FOUND', jobLog);
    return;
  }

  // 3. Claim a worker
  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);
  const worker = await selectWorker(redis);
  if (!worker) {
    jobLog.warn('no idle worker — re-enqueuing');
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }
  jobLog.info({ workerId: worker.id }, 'worker claimed');

  try {
    // 4. Presign input URLs (1h expiry — enough for ComfyUI to download)
    const [upperUrl, modelUrl, poseUrl, bgUrl, lowerUrl] = await Promise.all([
      storage.presignGet(inputs.upperGarmentKey, 3600).then((r) => r.url),
      storage.presignGet(modelKey, 3600).then((r) => r.url),
      storage.presignGet(poseKey, 3600).then((r) => r.url),
      storage.presignGet(bgKey, 3600).then((r) => r.url),
      storage.presignGet(lowerKey, 3600).then((r) => r.url),
    ]);

    // 5. Patch workflow template
    const prompt = patchWorkflow({
      upperGarmentUrl: upperUrl,
      modelUrl,
      poseUrl,
      backgroundUrl: bgUrl,
      lowerGarmentUrl: lowerUrl,
      outputPrefix: `aivastra_${jobId}`,
    });

    // 6. Submit to ComfyUI
    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: worker.id }, jobLog);
    const clientUuid = randomUUID();
    const { promptId } = await submitPrompt(worker.url, cfClientId, cfClientSecret, clientUuid, prompt);
    jobLog.info({ promptId }, 'prompt submitted to ComfyUI');

    // 7. Wait for completion via WebSocket (5 min max)
    await waitForCompletion(
      worker.url, cfClientId, cfClientSecret, clientUuid, promptId, 300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
    );

    // 8. Fetch output metadata + download image
    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(worker.url, cfClientId, cfClientSecret, promptId);
    if (!outputImages.length) throw new Error('ComfyUI returned no output images');

    const imageBytes = await downloadOutputImage(
      worker.url, cfClientId, cfClientSecret, outputImages[0]!.filename,
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
    await setWorkerStatus(redis, worker.id, 'IDLE');
    jobLog.info('job completed successfully');

  } catch (err) {
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, worker.id, 'IDLE');
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
