import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import type { StorageProvider } from '@aivastra/storage';
import { keys } from '@aivastra/storage';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  downloadOutputImage,
  fetchHistory,
  submitPrompt,
  uploadImageToComfy,
} from '../comfyui/client.js';
import { waitForCompletion } from '../comfyui/progress.js';
import { setWorkerStatus } from '../worker/registry.js';
import { selectWorker } from '../worker/selector.js';
import { patchWorkflow } from '../workflow/patcher.js';
import { transitionJob } from './state.js';

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
  if (!job) {
    jobLog.error('job not found — skipping');
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }
  if (job.status !== 'QUEUED') {
    jobLog.warn({ status: job.status }, 'job not QUEUED — skipping');
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }

  const [inputs] = await db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, jobId));
  if (!inputs) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_INPUTS', jobLog);
    return;
  }

  // 2. Resolve face / background / pose IDs → R2 keys
  const [bgRow] = await db
    .select({ r2Key: schema.modelBackgrounds.r2Key })
    .from(schema.modelBackgrounds)
    .where(eq(schema.modelBackgrounds.id, inputs.backgroundId));
  const [poseRow] = await db
    .select({
      r2Key: schema.modelPoses.r2Key,
      faceSideR2Key: schema.modelPoses.faceSideR2Key,
      bgComfyR2Key: schema.modelPoses.bgComfyR2Key,
      workflowTemplateId: schema.modelPoses.workflowTemplateId,
      promptFacePhase: schema.modelPoses.promptFacePhase,
      promptGarmentPhase: schema.modelPoses.promptGarmentPhase,
    })
    .from(schema.modelPoses)
    .where(eq(schema.modelPoses.id, inputs.poseId));

  if (!bgRow || !poseRow) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'CATALOG_NOT_FOUND', jobLog);
    return;
  }

  // faceSideR2Key is the ComfyUI-specific face image uploaded at pose creation time.
  // The display face (faceRow.r2Key) is UI-only and must never be sent to ComfyUI.
  const faceSideKey = poseRow.faceSideR2Key;
  if (!faceSideKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog);
    return;
  }

  // bgComfyR2Key is the ComfyUI-specific background; bgRow.r2Key is display-only.
  // Fall back to display background only for legacy poses that pre-date the bgComfy field.
  const bgKey = poseRow.bgComfyR2Key ?? bgRow.r2Key;
  const poseKey = poseRow.r2Key;
  const workflowTemplateId = poseRow.workflowTemplateId;

  // Resolve optional lower garment catalog ID → R2 key
  let lowerKey: string | null = null;
  if (inputs.lowerCatalogId) {
    const [lowerRow] = await db
      .select({ r2Key: schema.catalogItems.r2Key })
      .from(schema.catalogItems)
      .where(eq(schema.catalogItems.id, inputs.lowerCatalogId));
    if (lowerRow) lowerKey = lowerRow.r2Key;
    else
      jobLog.warn(
        { lowerCatalogId: inputs.lowerCatalogId },
        'lower garment catalog item not found — skipping',
      );
  }

  // Resolve optional shoe catalog ID → R2 key
  let shoeKey: string | null = null;
  if (inputs.shoeCatalogId) {
    const [shoeRow] = await db
      .select({ r2Key: schema.catalogItems.r2Key })
      .from(schema.catalogItems)
      .where(eq(schema.catalogItems.id, inputs.shoeCatalogId));
    if (shoeRow) shoeKey = shoeRow.r2Key;
    else
      jobLog.warn(
        { shoeCatalogId: inputs.shoeCatalogId },
        'shoe catalog item not found — skipping',
      );
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
      return uploadImageToComfy(
        w.url,
        workerApiKey,
        bytes,
        `${prefix}_${jobId}.${ext}`,
        `image/${ext === 'png' ? 'png' : 'jpeg'}`,
        jobLog,
      );
    }

    // 4. Upload only the images that ComfyUI actually needs.
    // Display images (faceRow.r2Key, bgRow.r2Key) are UI-only and never sent to ComfyUI.
    jobLog.info('uploading inputs to ComfyUI');
    const baseTasks: Promise<string>[] = [
      uploadToComfy(inputs.upperGarmentKey, 'garment'),
      uploadToComfy(faceSideKey, 'face'),
      uploadToComfy(poseKey, 'pose'),
      uploadToComfy(bgKey, 'bg'),
    ];
    if (lowerKey) baseTasks.push(uploadToComfy(lowerKey, 'lower'));
    if (shoeKey) baseTasks.push(uploadToComfy(shoeKey, 'shoe'));
    const uploaded = await Promise.all(baseTasks);

    let idx = 0;
    const upperGarmentFile = uploaded[idx++]!;
    const faceSideFile = uploaded[idx++]!;
    const poseFile = uploaded[idx++]!;
    const backgroundFile = uploaded[idx++]!;
    const lowerGarmentFile = lowerKey ? uploaded[idx++] : undefined;
    const shoeGarmentFile = shoeKey ? uploaded[idx++] : undefined;
    jobLog.info(
      {
        upperGarmentFile,
        faceSideFile,
        poseFile,
        backgroundFile,
        lowerGarmentFile,
        shoeGarmentFile,
      },
      'inputs uploaded',
    );

    // 5. Patch workflow template with ComfyUI filenames (loads from DB with 5-min TTL cache)
    const prompt = await patchWorkflow(
      {
        workflowTemplateId,
        upperGarmentFile,
        faceSideFile,
        poseFile,
        backgroundFile,
        lowerGarmentFile,
        shoeGarmentFile,
        promptFacePhase: poseRow.promptFacePhase ?? undefined,
        promptGarmentPhase: poseRow.promptGarmentPhase ?? undefined,
        aspectRatio: (inputs.params as Record<string, unknown> | null)?.aspectRatio as
          | string
          | undefined,
      },
      db,
      jobLog,
    );

    // 6. Submit to ComfyUI
    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const { promptId } = await submitPrompt(w.url, workerApiKey, clientUuid, prompt, jobLog);
    jobLog.info({ promptId }, 'prompt submitted to ComfyUI');

    // Store dispatch summary as a job event so admin can inspect what was sent to ComfyUI.
    // Full workflow JSON is stored under `prompt` — expand in jobs panel to debug node patches.
    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: {
          upperGarmentFile,
          faceSideFile,
          poseFile,
          backgroundFile,
          lowerGarmentFile,
          shoeGarmentFile,
          promptFacePhase: poseRow.promptFacePhase ?? null,
          promptGarmentPhase: poseRow.promptGarmentPhase ?? null,
          aspectRatio: (inputs.params as Record<string, unknown> | null)?.aspectRatio ?? null,
        },
        prompt,
      },
    });

    // 7. Wait for completion via WebSocket (5 min max)
    await waitForCompletion(
      w.url,
      workerApiKey,
      clientUuid,
      promptId,
      300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );

    // 8. Fetch output metadata + download image
    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, workerApiKey, promptId, jobLog);
    if (!outputImages.length) throw new Error('ComfyUI returned no output images');

    const imageBytes = await downloadOutputImage(w.url, workerApiKey, outputImages[0]!.filename);

    // 9. Upload result to R2
    const resultKey = keys.output(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: resultKey,
        Body: imageBytes,
        ContentType: 'image/png',
      }),
    );

    // 10. Mark COMPLETED
    await transitionJob(db, pub, jobId, userId, 'COMPLETED', { resultKey }, jobLog);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    jobLog.info('job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, errMsg);
  }
}

async function handleFailure(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  log: Logger,
  errorMessage?: string,
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
    const errorCode = errorMessage ? errorMessage.slice(0, 1000) : 'MAX_RETRIES';
    await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode }, log);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.warn({ jobId, attempts: newAttempts }, 'job FAILED after max retries — credits refunded');
  } else {
    // Re-enqueue for retry
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    log.info(
      { jobId, attempts: newAttempts },
      `job re-enqueued for retry (attempt ${newAttempts})`,
    );
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
