import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import {
  comfyRequestDuration,
  jobAttemptsTotal,
  jobProcessingDuration,
  jobsProcessedTotal,
} from '@aivastra/observability';
import type { StorageProvider } from '@aivastra/storage';
import { keys } from '@aivastra/storage';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
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
import { finalizeOutput } from '../workflow/finalize.js';
import { transitionJob } from './state.js';

const MAX_ATTEMPTS = 2;
const MAX_QUEUE_WAIT_MS = 3 * 60 * 60 * 1000; // 3 h — dead-letter if no worker found this long

type JobOutcome = 'success' | 'failed' | 'retried';

/** Record the terminal (or retry) outcome of a processing attempt with its duration. */
function recordJobOutcome(outcome: JobOutcome, startedAt: number): void {
  jobsProcessedTotal.inc({ outcome });
  jobProcessingDuration.observe({ outcome }, (Date.now() - startedAt) / 1000);
}

export interface ProcessorConfig {
  db: DB;
  redis: Redis;
  pub: Redis;
  storage: StorageProvider;
  s3: S3Client;
  r2Bucket: string;
  widgetComfyUrl?: string;
  widgetComfyBasicAuth?: string;
  log: Logger;
}

export async function processJob(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket, log } = cfg;
  const jobLog = log.child({ jobId, userId });
  const startedAt = Date.now();

  // 1. Load job + inputs (select only what the processor needs)
  const [job] = await db
    .select({
      id: schema.jobs.id,
      status: schema.jobs.status,
      widgetClientId: schema.jobs.widgetClientId,
      customerPhotoKey: schema.jobs.customerPhotoKey,
      creditsCharged: schema.jobs.creditsCharged,
      attempts: schema.jobs.attempts,
      createdAt: schema.jobs.createdAt,
      watermark: schema.jobs.watermark,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job) {
    jobLog.error('job not found — skipping');
    await redis.xack(stream, 'dispatcher-cg', messageId);
    return;
  }
  if (job.status !== 'QUEUED') {
    const IN_PROGRESS = ['PREPROCESSING', 'GENERATING', 'UPLOADING'] as const;
    if ((IN_PROGRESS as readonly string[]).includes(job.status)) {
      // Dispatcher crashed mid-job — count as a failed attempt so it retries or terminates+refunds
      jobLog.warn(
        { status: job.status },
        'job found in-progress after reclaim — treating as crash failure',
      );
      await handleFailure(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        jobLog,
        startedAt,
        'DISPATCHER_CRASH',
      );
    } else {
      // Already terminal (COMPLETED, FAILED) — ACK the stale PEL entry and move on
      jobLog.warn({ status: job.status }, 'job already terminal — ACKing stale PEL entry');
      await redis.xack(stream, 'dispatcher-cg', messageId);
    }
    return;
  }

  // Past the skip checks — this is a real processing attempt.
  jobAttemptsTotal.inc();

  const [inputs] = await db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, jobId));
  if (!inputs) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_INPUTS', jobLog, startedAt);
    return;
  }

  // Widget jobs: widgetClientId set, faceId/bgId/poseId are null — route to dedicated processor.
  if (job.widgetClientId) {
    await processWidgetJob(cfg, job, inputs, stream, messageId, jobLog, startedAt);
    return;
  }

  // Tryon direct jobs: no face/background/pose — person + garment keys stored in params
  const rawParams =
    typeof inputs.params === 'string'
      ? (JSON.parse(inputs.params) as Record<string, unknown>)
      : ((inputs.params ?? {}) as Record<string, unknown>);

  if (!inputs.faceId && !inputs.backgroundId && !inputs.poseId && rawParams.personKey) {
    await processTryonDirectJob(
      cfg,
      job,
      inputs,
      rawParams,
      userId,
      stream,
      messageId,
      jobLog,
      startedAt,
    );
    return;
  }

  // Saree jobs: kind === 'saree' in jobInputs.params. Two image inputs (model + saree),
  // admin-configured modelKey and user-uploaded garmentKey. Saree jobs route to
  // workers with 'saree' in their allowedJobTypes (selectWorker below).
  if (!inputs.faceId && !inputs.backgroundId && !inputs.poseId && rawParams.kind === 'saree') {
    await processSareeJob(
      cfg,
      job,
      inputs,
      rawParams,
      userId,
      stream,
      messageId,
      jobLog,
      startedAt,
    );
    return;
  }

  // Regular jobs must have all three model references (guards also narrow nullable types below)
  if (!inputs.faceId || !inputs.backgroundId || !inputs.poseId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MISSING_MODEL_INPUTS',
      jobLog,
      startedAt,
    );
    return;
  }

  // 2. Resolve face / background / pose IDs → R2 keys
  const [faceRow] = await db
    .select({ r2Key: schema.modelFaces.r2Key, faceSideR2Key: schema.modelFaces.faceSideR2Key })
    .from(schema.modelFaces)
    .where(eq(schema.modelFaces.id, inputs.faceId));
  const [bgRow] = await db
    .select({
      r2Key: schema.modelBackgrounds.r2Key,
    })
    .from(schema.modelBackgrounds)
    .where(eq(schema.modelBackgrounds.id, inputs.backgroundId));
  const [poseRow] = await db
    .select({
      r2Key: schema.modelPoseAssets.r2Key,
      workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
      promptFacePhase: schema.modelPoseAssets.promptFacePhase,
      promptGarmentPhase: schema.modelPoseAssets.promptGarmentPhase,
    })
    .from(schema.modelPoseAssets)
    .where(eq(schema.modelPoseAssets.id, inputs.poseId));

  if (!faceRow || !bgRow || !poseRow) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'CATALOG_NOT_FOUND', jobLog, startedAt);
    return;
  }

  // If job has a garmentTypeId, check for per-type workflow/prompt overrides.
  let effectiveWorkflowTemplateId = poseRow.workflowTemplateId;
  let effectivePromptFacePhase = poseRow.promptFacePhase;
  let effectivePromptGarmentPhase = poseRow.promptGarmentPhase;
  if (inputs.garmentTypeId) {
    const [cfgRow] = await db
      .select({
        workflowTemplateId: schema.poseGarmentConfigs.workflowTemplateId,
        promptFacePhase: schema.poseGarmentConfigs.promptFacePhase,
        promptGarmentPhase: schema.poseGarmentConfigs.promptGarmentPhase,
      })
      .from(schema.poseGarmentConfigs)
      .where(
        and(
          eq(schema.poseGarmentConfigs.poseAssetId, inputs.poseId),
          eq(schema.poseGarmentConfigs.subcategoryId, inputs.garmentTypeId),
        ),
      );
    if (cfgRow) {
      if (cfgRow.workflowTemplateId) effectiveWorkflowTemplateId = cfgRow.workflowTemplateId;
      if (cfgRow.promptFacePhase) effectivePromptFacePhase = cfgRow.promptFacePhase;
      if (cfgRow.promptGarmentPhase) effectivePromptGarmentPhase = cfgRow.promptGarmentPhase;
    }
  }

  // faceSideR2Key is the preferred ComfyUI-specific face image.
  // Falls back to r2Key when faceSideR2Key is not set (faces uploaded before the column was added).
  const faceSideKey = faceRow.faceSideR2Key ?? faceRow.r2Key;
  if (!faceSideKey) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog, startedAt);
    return;
  }
  if (!faceRow.faceSideR2Key) {
    jobLog.warn({ faceId: inputs.faceId }, 'faceSideR2Key not set — falling back to display r2Key');
  }

  // Backgrounds now use a single image (r2Key) for both display and ComfyUI.
  // (The legacy separate bgComfyR2Key column is no longer used.)
  let params: Record<string, unknown> = {};
  if (inputs.params) {
    params =
      typeof inputs.params === 'string'
        ? JSON.parse(inputs.params)
        : (inputs.params as Record<string, unknown>);
  }
  const isAmazon = params.platform === 'Amazon';
  jobLog.info({ platform: params.platform, isAmazon }, 'platform check');
  const bgKey = bgRow.r2Key;
  const bgSource = isAmazon ? 'amazon-override' : 'single-image';
  const poseKey = poseRow.r2Key;
  const workflowTemplateId = effectiveWorkflowTemplateId;
  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }
  jobLog.info(
    { faceSideKey, bgKeyResolved: bgKey, bgSource, poseKey, workflowTemplateId },
    'resolved R2 keys for ComfyUI upload',
  );

  // Resolve lower garment: user-uploaded key takes priority over catalog ID
  let lowerKey: string | null = null;
  if (inputs.lowerGarmentKey) {
    lowerKey = inputs.lowerGarmentKey;
  } else if (inputs.lowerCatalogId) {
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
  const worker = await selectWorker(redis, 'catalogue');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle worker — job exceeded max queue wait, terminating with refund');
      await terminateJob(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'NO_WORKER',
        job.creditsCharged,
        jobLog,
        startedAt,
      );
    } else {
      jobLog.warn('no idle worker — re-enqueuing with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
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
      // M8: derive the extension from a strict allow-list, never from the raw
      // key. The filename sent to ComfyUI /upload/image is built only from our
      // own `prefix` + `jobId` + a known-safe ext, so no key content (path
      // separators, traversal) can reach the worker filesystem.
      const rawExt = key.split('.').pop()?.toLowerCase() ?? '';
      const ext = rawExt === 'png' ? 'png' : rawExt === 'webp' ? 'webp' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return uploadImageToComfy(w.url, w.apiKey, bytes, `${prefix}_${jobId}.${ext}`, mime, jobLog);
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
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const upperGarmentFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const faceSideFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
    const poseFile = uploaded[idx++]!;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces these 4 entries in order
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
    const jobParams = (inputs.params as Record<string, unknown> | null) ?? {};
    const jobAspectRatio = jobParams.aspectRatio as string | undefined;
    const jobOutputWidth =
      typeof jobParams.outputWidth === 'number' ? jobParams.outputWidth : undefined;
    const jobOutputHeight =
      typeof jobParams.outputHeight === 'number' ? jobParams.outputHeight : undefined;

    const { prompt, resultNodeId } = await patchWorkflow(
      {
        workflowTemplateId,
        upperGarmentFile,
        faceSideFile,
        poseFile,
        backgroundFile,
        lowerGarmentFile,
        shoeGarmentFile,
        promptFacePhase: effectivePromptFacePhase ?? undefined,
        promptGarmentPhase: effectivePromptGarmentPhase ?? undefined,
        aspectRatio: jobAspectRatio,
        outputWidth: jobOutputWidth,
        outputHeight: jobOutputHeight,
      },
      db,
      jobLog,
    );

    // 6. Submit to ComfyUI
    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, prompt, jobLog);
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
          promptFacePhase: effectivePromptFacePhase ?? null,
          promptGarmentPhase: effectivePromptGarmentPhase ?? null,
          aspectRatio: jobAspectRatio ?? null,
          outputWidth: jobOutputWidth ?? null,
          outputHeight: jobOutputHeight ?? null,
          _r2Keys: {
            upperGarmentKey: inputs.upperGarmentKey,
            faceSideKey,
            poseKey,
            bgKey,
            bgSource,
            lowerKey,
            shoeKey,
          },
        },
        prompt,
      },
    });

    // 7. Wait for completion via WebSocket (5 min max)
    await waitForCompletion(
      w.url,
      w.apiKey,
      clientUuid,
      promptId,
      300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );
    comfyRequestDuration.observe((Date.now() - comfyStartedAt) / 1000);

    // 8. Fetch output metadata + download image
    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(
      w.url,
      w.apiKey,
      promptId,
      jobLog,
      resultNodeId ?? undefined,
    );
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    // 9. Finalize: upload result + thumbnail, write job_outputs, transition COMPLETED.
    await finalizeOutput({
      imageBytes,
      jobId,
      userId,
      jobWatermark: job.watermark,
      db,
      pub,
      s3,
      r2Bucket,
      jobLog,
    });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info('job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

// ── Tryon direct job processor ────────────────────────────────────────────

type TryonDirectJob = {
  id: string;
  creditsCharged: number;
  attempts: number;
  createdAt: Date;
  watermark: boolean;
};

async function processTryonDirectJob(
  cfg: ProcessorConfig,
  job: TryonDirectJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  params: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;

  const personKey = params.personKey as string;
  const workflowTemplateId = params.workflowTemplateId as string;
  const garmentKey = inputs.upperGarmentKey;

  if (!workflowTemplateId) {
    await markFailed(cfg, jobId, userId, stream, messageId, 'NO_WORKFLOW', jobLog, startedAt);
    return;
  }

  // Load tryon workflow template
  const [template] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      tryonPersonNodeId: schema.workflowTemplates.tryonPersonNodeId,
      tryonGarmentNodeId: schema.workflowTemplates.tryonGarmentNodeId,
      tryonOutputNodeId: schema.workflowTemplates.tryonOutputNodeId,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));

  if (!template) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'WORKFLOW_NOT_FOUND',
      jobLog,
      startedAt,
    );
    return;
  }

  const personNodeId = template.tryonPersonNodeId;
  const garmentNodeId = template.tryonGarmentNodeId;
  const outputNodeId = template.tryonOutputNodeId;

  if (!personNodeId || !garmentNodeId || !outputNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'TRYON_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);
  const worker = await selectWorker(redis, 'tryon');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle tryon worker — job exceeded max queue wait, terminating with refund');
      await terminateJob(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'NO_WORKER',
        job.creditsCharged,
        jobLog,
        startedAt,
      );
    } else {
      jobLog.warn('no idle worker — re-enqueuing tryon direct job with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for tryon direct');

  try {
    async function r2Download(key: string): Promise<Uint8Array> {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 object missing: ${key}`);
      return res.Body.transformToByteArray();
    }

    async function uploadToComfy(key: string, prefix: string): Promise<string> {
      const bytes = await r2Download(key);
      const rawExt = key.split('.').pop()?.toLowerCase() ?? '';
      const ext = rawExt === 'png' ? 'png' : rawExt === 'webp' ? 'webp' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return uploadImageToComfy(w.url, w.apiKey, bytes, `${prefix}_${jobId}.${ext}`, mime, jobLog);
    }

    jobLog.info('uploading tryon direct inputs to ComfyUI');
    const [personFile, garmentFile] = await Promise.all([
      uploadToComfy(personKey, 'person'),
      uploadToComfy(garmentKey, 'garment'),
    ]);
    jobLog.info({ personFile, garmentFile }, 'tryon direct inputs uploaded');

    // Clone and patch workflow
    const workflow = structuredClone(template.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    if (workflow[personNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[personNodeId].inputs!.image = personFile;
    }
    if (workflow[garmentNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[garmentNodeId].inputs!.image = garmentFile;
    }

    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'tryon direct prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { personKey, garmentKey, personFile, garmentFile },
      },
    });

    await waitForCompletion(
      w.url,
      w.apiKey,
      clientUuid,
      promptId,
      300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );
    comfyRequestDuration.observe((Date.now() - comfyStartedAt) / 1000);

    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, outputNodeId);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for tryon direct job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    // Finalize: upload result + thumbnail, write job_outputs, transition COMPLETED.
    await finalizeOutput({
      imageBytes,
      jobId,
      userId,
      jobWatermark: job.watermark,
      db,
      pub,
      s3,
      r2Bucket,
      jobLog,
    });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info('tryon direct job completed');
  } catch (err) {
    jobLog.error({ err }, 'tryon direct job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

// ── Saree job processor ────────────────────────────────────────────────────

type SareeJob = {
  id: string;
  creditsCharged: number;
  attempts: number;
  createdAt: Date;
  watermark: boolean;
};

async function processSareeJob(
  cfg: ProcessorConfig,
  job: SareeJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  params: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;

  const modelKey = params.modelKey as string | undefined;
  const workflowTemplateId = params.workflowTemplateId as string | undefined;
  const garmentKey = inputs.upperGarmentKey;

  if (!modelKey || !workflowTemplateId || !garmentKey) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'SARE_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  // Load saree workflow template. Saree flows reuse the tryon*_node_id columns
  // on workflow_templates (the admin route writes those columns at upload time).
  const [template] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      tryonPersonNodeId: schema.workflowTemplates.tryonPersonNodeId,
      tryonGarmentNodeId: schema.workflowTemplates.tryonGarmentNodeId,
      tryonOutputNodeId: schema.workflowTemplates.tryonOutputNodeId,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));

  if (!template) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'WORKFLOW_NOT_FOUND',
      jobLog,
      startedAt,
    );
    return;
  }

  const modelNodeId = template.tryonPersonNodeId;
  const sareeNodeId = template.tryonGarmentNodeId;
  const outputNodeId = template.tryonOutputNodeId;

  if (!modelNodeId || !sareeNodeId || !outputNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'SARE_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);

  // Saree jobs route to workers with 'saree' in their allowedJobTypes. Workers
  // self-declare this in the workers table (admin can edit from the Workers page).
  const worker = await selectWorker(redis, 'saree');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle saree worker — job exceeded max queue wait, terminating with refund');
      await terminateJob(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'NO_WORKER',
        job.creditsCharged,
        jobLog,
        startedAt,
      );
    } else {
      jobLog.warn('no idle saree worker — re-enqueuing with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for saree');

  try {
    async function r2Download(key: string): Promise<Uint8Array> {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 object missing: ${key}`);
      return res.Body.transformToByteArray();
    }

    async function uploadToComfy(key: string, prefix: string): Promise<string> {
      const bytes = await r2Download(key);
      const rawExt = key.split('.').pop()?.toLowerCase() ?? '';
      const ext = rawExt === 'png' ? 'png' : rawExt === 'webp' ? 'webp' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return uploadImageToComfy(w.url, w.apiKey, bytes, `${prefix}_${jobId}.${ext}`, mime, jobLog);
    }

    jobLog.info('uploading saree inputs to ComfyUI');
    const [modelFile, sareeFile] = await Promise.all([
      uploadToComfy(modelKey, 'saree_model'),
      uploadToComfy(garmentKey, 'saree_garment'),
    ]);
    jobLog.info({ modelFile, sareeFile }, 'saree inputs uploaded');

    // Clone and patch workflow
    const workflow = structuredClone(template.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    if (workflow[modelNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[modelNodeId].inputs!.image = modelFile;
    }
    if (workflow[sareeNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[sareeNodeId].inputs!.image = sareeFile;
    }

    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'saree prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { modelKey, garmentKey, modelFile, sareeFile },
      },
    });

    await waitForCompletion(
      w.url,
      w.apiKey,
      clientUuid,
      promptId,
      300_000,
      (update) => jobLog.debug(update, 'comfyui progress'),
      { info: jobLog.info.bind(jobLog), debug: jobLog.debug.bind(jobLog) },
    );
    comfyRequestDuration.observe((Date.now() - comfyStartedAt) / 1000);

    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, outputNodeId);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for saree job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    // Finalize: upload result + thumbnail, write job_outputs, transition COMPLETED.
    await finalizeOutput({
      imageBytes,
      jobId,
      userId,
      jobWatermark: job.watermark,
      db,
      pub,
      s3,
      r2Bucket,
      jobLog,
    });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info('saree job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'saree job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

// ── Widget job processor ───────────────────────────────────────────────────

type WidgetJob = {
  id: string;
  widgetClientId: string | null;
  customerPhotoKey: string | null;
  creditsCharged: number;
};

async function processWidgetJob(
  cfg: ProcessorConfig,
  job: WidgetJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket, widgetComfyUrl, widgetComfyBasicAuth } = cfg;
  const jobId = job.id;
  // biome-ignore lint/style/noNonNullAssertion: widgetClientId is guaranteed non-null for widget jobs
  const widgetClientId = job.widgetClientId!;
  const { creditsCharged } = job;

  if (!widgetComfyUrl || !widgetComfyBasicAuth) {
    jobLog.error('WIDGET_COMFYUI_URL / WIDGET_COMFYUI_BASIC_AUTH not configured');
    await markWidgetFailed(
      cfg,
      jobId,
      widgetClientId,
      creditsCharged,
      stream,
      messageId,
      'WIDGET_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  if (!job.customerPhotoKey) {
    await markWidgetFailed(
      cfg,
      jobId,
      widgetClientId,
      creditsCharged,
      stream,
      messageId,
      'NO_CUSTOMER_PHOTO',
      jobLog,
      startedAt,
    );
    return;
  }
  const customerPhotoKey = job.customerPhotoKey;

  // Load workflow template from DB (any active widget-type template)
  const [templateRow] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      widgetGarmentNodeId: schema.workflowTemplates.widgetGarmentNodeId,
      widgetCustomerPhotoNodeId: schema.workflowTemplates.widgetCustomerPhotoNodeId,
      widgetOutputNodeId: schema.workflowTemplates.widgetOutputNodeId,
    })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'widget'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  if (!templateRow) {
    jobLog.error('no active widget workflow template found in workflow_templates table');
    await markWidgetFailed(
      cfg,
      jobId,
      widgetClientId,
      creditsCharged,
      stream,
      messageId,
      'WIDGET_TEMPLATE_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  const garmentNodeId = templateRow.widgetGarmentNodeId ?? '31';
  const customerPhotoNodeId = templateRow.widgetCustomerPhotoNodeId ?? '139';
  const outputNodeId = templateRow.widgetOutputNodeId ?? '134';

  await transitionJob(db, pub, jobId, '', 'PREPROCESSING', {}, jobLog);

  // Basic Auth header for all widget VPS requests
  const authHeader = `Basic ${Buffer.from(widgetComfyBasicAuth).toString('base64')}`;

  try {
    // Download both images from R2
    async function r2Download(key: string): Promise<Uint8Array> {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 object missing: ${key}`);
      return res.Body.transformToByteArray();
    }

    const [customerPhotoBytes, garmentBytes] = await Promise.all([
      r2Download(customerPhotoKey),
      r2Download(inputs.upperGarmentKey),
    ]);

    // Upload to widget ComfyUI VPS (Basic Auth, not X-Api-Key)
    async function uploadToWidgetComfy(
      bytes: Uint8Array,
      filename: string,
      contentType: string,
    ): Promise<string> {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: contentType }), filename);
      form.append('overwrite', 'true');
      const res = await fetch(`${widgetComfyUrl}/upload/image`, {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Widget ComfyUI /upload/image failed: ${res.status}`);
      const json = (await res.json()) as { name: string };
      return json.name;
    }

    const garmentExt = inputs.upperGarmentKey.split('.').pop()?.toLowerCase() ?? 'jpg';
    const garmentMime =
      garmentExt === 'png' ? 'image/png' : garmentExt === 'webp' ? 'image/webp' : 'image/jpeg';
    const photoExt = customerPhotoKey.split('.').pop()?.toLowerCase() ?? 'jpg';
    const photoMime =
      photoExt === 'png' ? 'image/png' : photoExt === 'webp' ? 'image/webp' : 'image/jpeg';

    jobLog.info('uploading inputs to widget ComfyUI');
    const [garmentFilename, customerPhotoFilename] = await Promise.all([
      uploadToWidgetComfy(garmentBytes, `garment_${jobId}.${garmentExt}`, garmentMime),
      uploadToWidgetComfy(customerPhotoBytes, `photo_${jobId}.${photoExt}`, photoMime),
    ]);
    jobLog.info({ garmentFilename, customerPhotoFilename }, 'widget inputs uploaded to VPS');

    // Clone and patch workflow using node IDs from DB
    const workflow = structuredClone(templateRow.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
    if (workflow[garmentNodeId]?.inputs) workflow[garmentNodeId].inputs!.image = garmentFilename;
    if (workflow[customerPhotoNodeId]?.inputs)
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[customerPhotoNodeId].inputs!.image = customerPhotoFilename;

    // Submit prompt
    await transitionJob(db, pub, jobId, '', 'GENERATING', {}, jobLog);
    const clientUuid = randomUUID();
    const promptRes = await fetch(`${widgetComfyUrl}/prompt`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientUuid }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!promptRes.ok) throw new Error(`Widget ComfyUI /prompt failed: ${promptRes.status}`);
    const { prompt_id: promptId } = (await promptRes.json()) as { prompt_id: string };
    jobLog.info({ promptId }, 'widget prompt submitted');

    // Poll /history every 2s (max 5 min) — WebSocket skipped; Basic Auth + polling matches the PHP approach
    const RESULT_NODE = outputNodeId;
    const deadline = Date.now() + 300_000;
    type ComfyImage = { filename: string; subfolder: string; type: string };
    let outputImages: ComfyImage[] = [];

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const histRes = await fetch(`${widgetComfyUrl}/history/${promptId}`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!histRes?.ok) continue;

      type HistEntry = { outputs?: Record<string, { images?: ComfyImage[] }> };
      const history = (await histRes.json()) as Record<string, HistEntry>;
      const nodeImages = history[promptId]?.outputs?.[RESULT_NODE]?.images;
      if (nodeImages?.length) {
        outputImages = nodeImages.filter((img) => img.type === 'output');
        break;
      }
    }
    if (!outputImages.length)
      throw new Error(`Widget ComfyUI timeout — no output images from node ${outputNodeId}`);

    // Download output image from VPS
    await transitionJob(db, pub, jobId, '', 'UPLOADING', {}, jobLog);
    // biome-ignore lint/style/noNonNullAssertion: outputImages is non-empty (checked by ComfyUI response)
    const firstImage = outputImages[0]!;
    const viewUrl = `${widgetComfyUrl}/view?filename=${encodeURIComponent(firstImage.filename)}&subfolder=${encodeURIComponent(firstImage.subfolder)}&type=${encodeURIComponent(firstImage.type)}`;
    const imgRes = await fetch(viewUrl, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) throw new Error(`Widget ComfyUI /view failed: ${imgRes.status}`);
    const imageBytes = new Uint8Array(await imgRes.arrayBuffer());

    // Upload result to R2
    const resultKey = `widget-outputs/${jobId}/result.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: resultKey,
        Body: imageBytes,
        ContentType: 'image/png',
      }),
    );

    // Mark COMPLETED (transitionJob handles DB + admin SSE; publish widget channel separately)
    await transitionJob(db, pub, jobId, '', 'COMPLETED', { resultKey }, jobLog);
    await pub.publish(
      `sse:events:widget:${widgetClientId}`,
      JSON.stringify({ jobId, type: 'STATUS', status: 'COMPLETED', resultKey }),
    );
    await redis.xadd(
      'webhooks:outbound',
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      jobId,
      'widgetClientId',
      widgetClientId,
      'status',
      'COMPLETED',
      'resultKey',
      resultKey,
    );
    await redis.xack(stream, 'dispatcher-cg', messageId);
    recordJobOutcome('success', startedAt);
    jobLog.info({ resultKey }, 'widget job completed successfully');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    jobLog.error({ err }, 'widget job processing error');
    await markWidgetFailed(
      cfg,
      jobId,
      widgetClientId,
      creditsCharged,
      stream,
      messageId,
      errMsg.slice(0, 1000),
      jobLog,
      startedAt,
    );
  }
}

async function markWidgetFailed(
  cfg: ProcessorConfig,
  jobId: string,
  widgetClientId: string,
  creditsCharged: number,
  stream: string,
  messageId: string,
  errorCode: string,
  log: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub } = cfg;

  // Refund widget credits (idempotent)
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.widgetCreditLedger)
      .where(
        and(
          eq(schema.widgetCreditLedger.jobId, jobId),
          eq(schema.widgetCreditLedger.reason, 'JOB_FAIL_REFUND'),
        ),
      );
    if (existing.length) return;
    await tx
      .update(schema.widgetClientCredits)
      .set({ balance: sql`${schema.widgetClientCredits.balance} + ${creditsCharged}` })
      .where(eq(schema.widgetClientCredits.widgetClientId, widgetClientId));
    await tx
      .insert(schema.widgetCreditLedger)
      .values({ widgetClientId, delta: creditsCharged, reason: 'JOB_FAIL_REFUND', jobId });
  });

  await transitionJob(db, pub, jobId, '', 'FAILED', { errorCode }, log);
  await pub.publish(
    `sse:events:widget:${widgetClientId}`,
    JSON.stringify({ jobId, type: 'STATUS', status: 'FAILED', errorCode }),
  );
  await redis.xadd(
    'webhooks:outbound',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'widgetClientId',
    widgetClientId,
    'status',
    'FAILED',
    'errorCode',
    errorCode,
  );
  await redis.xack(stream, 'dispatcher-cg', messageId);
  recordJobOutcome('failed', startedAt);
  log.warn({ jobId, errorCode }, 'widget job FAILED — widget credits refunded');
}

// ── Regular job failure handling ───────────────────────────────────────────

// Shared terminal path: refund credits + mark FAILED atomically, then ACK.
// Called by both markFailed (pre-flight) and handleFailure (max retries).
// The refund and status transition share one DB transaction so a crash between
// them can't leave the job refunded-but-not-failed or failed-but-not-refunded.
// SSE publish is after the transaction — best-effort; clients reconnect on miss.
async function terminateJob(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  errorCode: string,
  creditsCharged: number,
  _log: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub } = cfg;
  const now = new Date();

  await db.transaction(async (tx) => {
    // Insert ledger row first — unique index on (job_id, reason) prevents double-refund.
    if (creditsCharged > 0) {
      const inserted = await tx
        .insert(schema.creditLedger)
        .values({ userId, delta: creditsCharged, reason: 'JOB_FAIL_REFUND', jobId })
        .onConflictDoNothing()
        .returning({ id: schema.creditLedger.id });
      if (!inserted.length) return; // already refunded — skip balance update too
      await tx
        .update(schema.userCredits)
        .set({ balance: sql`${schema.userCredits.balance} + ${creditsCharged}` })
        .where(eq(schema.userCredits.userId, userId));
    }

    // Status transition — inlined so it's atomic with the refund above
    await tx
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode, completedAt: now } as Parameters<
        ReturnType<typeof tx.update>['set']
      >[0])
      .where(eq(schema.jobs.id, jobId));
    await tx.insert(schema.jobEvents).values({
      jobId,
      eventType: 'FAILED',
      payload: { errorCode } as Record<string, unknown>,
    });
  });

  // SSE publish after commit — not critical, clients reconnect on miss
  const ssePayload = JSON.stringify({ jobId, userId, type: 'STATUS', status: 'FAILED', errorCode });
  await Promise.all([
    pub.publish(`sse:events:${userId}`, ssePayload),
    pub.publish('sse:events:admin', ssePayload),
  ]);

  await redis.xack(stream, 'dispatcher-cg', messageId);
  recordJobOutcome('failed', startedAt);
}

async function handleFailure(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  stream: string,
  messageId: string,
  log: Logger,
  startedAt: number,
  errorMessage?: string,
): Promise<void> {
  const { db, redis, pub } = cfg;

  const [current] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!current) return;

  const newAttempts = current.attempts + 1;
  await db.update(schema.jobs).set({ attempts: newAttempts }).where(eq(schema.jobs.id, jobId));

  if (newAttempts >= MAX_ATTEMPTS) {
    const errorCode = errorMessage ? errorMessage.slice(0, 1000) : 'MAX_RETRIES';
    await terminateJob(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      errorCode,
      current.creditsCharged,
      log,
      startedAt,
    );
    log.warn(
      { jobId, attempts: newAttempts, errorCode },
      'job FAILED after max retries — credits refunded',
    );
  } else {
    // Re-enqueue for retry
    await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
    await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    recordJobOutcome('retried', startedAt);
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
  startedAt: number,
): Promise<void> {
  const [job] = await cfg.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  await terminateJob(
    cfg,
    jobId,
    userId,
    stream,
    messageId,
    errorCode,
    job?.creditsCharged ?? 0,
    log,
    startedAt,
  );
  log.warn({ jobId, errorCode }, 'job FAILED (pre-flight) — credits refunded');
}
