import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import {
  comfyRequestDuration,
  jobAttemptsTotal,
  jobProcessingDuration,
  jobsProcessedTotal,
} from '@aivastra/observability';
import { keys, type StorageProvider } from '@aivastra/storage';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import sharp from 'sharp';

import {
  downloadOutputImage,
  fetchHistory,
  submitPrompt,
  uploadImageToComfy,
} from '../comfyui/client.js';
import { waitForCompletion } from '../comfyui/progress.js';
import { loadEnv } from '../env.js';
import { createVideoTask, pollVideoTask } from '../pixverse/client.js';
import { setWorkerStatus } from '../worker/registry.js';
import { selectWorker } from '../worker/selector.js';
import { finalizeOutput } from '../workflow/finalize.js';
import { patchWorkflow } from '../workflow/patcher.js';
import { runMannequinPhase } from './mannequin-phase.js';
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
      userId: schema.jobs.userId,
      merchantId: schema.jobs.merchantId,
      shopifyStoreId: schema.jobs.shopifyStoreId,
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

  // Widget jobs: merchantId/shopifyStoreId set, faceId/bgId/poseId are null — route to dedicated processor.
  if (job.merchantId || job.shopifyStoreId) {
    await processWidgetJob(cfg, job, inputs, stream, messageId, jobLog, startedAt);
    return;
  }

  // Tryon direct jobs: no face/background/pose — person + garment keys stored in params
  const rawParams =
    typeof inputs.params === 'string'
      ? (JSON.parse(inputs.params) as Record<string, unknown>)
      : ((inputs.params ?? {}) as Record<string, unknown>);

  // Catalog-video jobs use PixVerse image-to-video and never require a ComfyUI worker.
  if (!inputs.faceId && !inputs.backgroundId && !inputs.poseId && rawParams.kind === 'video') {
    await processVideoJob(cfg, jobId, rawParams, userId, stream, messageId, jobLog, startedAt);
    return;
  }

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

  // Saree mannequin (step-1) jobs: kind === 'saree_mannequin' in jobInputs.params.
  // Draped-mannequin generation, run once per flat-saree job regardless of pose
  // count; 0 credits; never surfaced to the user (see createSareeMannequinJob).
  // No backgroundId/poseId is what distinguishes this from every other job shape —
  // faceId itself is optional here: present for Studio-triggered jobs (a real
  // selected model), null for dev-API jobs whose template bakes the face in via
  // a fixed URL node instead (see processSareeMannequinJob's tryonPersonNodeId check).
  if (!inputs.backgroundId && !inputs.poseId && rawParams.kind === 'saree_mannequin') {
    await processSareeMannequinJob(
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

  // Saree jobs (standalone feature, being retired — see Task 19 of the
  // flat-saree-two-step-workflow plan): kind === 'saree' in jobInputs.params.
  // Two image inputs (model + saree), admin-configured modelKey and
  // user-uploaded garmentKey. Kept alongside the mannequin branch above until
  // the API-side POST /v1/jobs/saree route (and this handler) are deleted
  // together in Task 19 — until then, jobs already in flight or created by
  // any client still hitting that route must keep working.
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
  let effectiveUpperGarmentKey = inputs.upperGarmentKey;
  const snapshottedWorkflowTemplateId =
    typeof rawParams.workflowTemplateId === 'string' ? rawParams.workflowTemplateId : null;
  if (snapshottedWorkflowTemplateId) {
    effectiveWorkflowTemplateId = snapshottedWorkflowTemplateId;
    effectivePromptFacePhase = null;
    effectivePromptGarmentPhase =
      typeof rawParams.promptGarmentPhase === 'string' ? rawParams.promptGarmentPhase : null;
  } else if (inputs.garmentTypeId) {
    const [garmentTypeRow] = await db
      .select({
        requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
        sareeStep2WorkflowTemplateId: schema.garmentSubcategories.sareeStep2WorkflowTemplateId,
        mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      })
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, inputs.garmentTypeId));
    if (garmentTypeRow?.requiresMannequinStep) {
      // Flat-saree (and any future two-pass) garment types use ONE workflow for
      // every pose, set directly on the garment type — bypasses the normal
      // per-pose pose_garment_configs override entirely (a saree pose's own
      // workflow assignment, if any, is ignored). Flat-saree jobs never carry
      // a catalogue-template-mapping snapshot, so in practice this is the
      // top-precedence tier whenever it applies.
      effectiveWorkflowTemplateId = garmentTypeRow.sareeStep2WorkflowTemplateId;

      // Callers that hand the dispatcher a raw (never-mannequin-processed) flat
      // photo opt in via params.needsMannequinStep - the web studio flow instead
      // pre-resolves this client-side (resolveMannequinGarmentKey) BEFORE the
      // job is even created, so its upperGarmentKey is already a mannequin
      // output and this branch must NOT be entered for it (see
      // saree-step2-workflow-override.test.ts, which asserts that exact
      // pre-resolved-key behavior and has no needsMannequinStep set).
      if (rawParams.needsMannequinStep === true) {
        if (!garmentTypeRow.mannequinWorkflowTemplateId) {
          await markFailed(
            cfg,
            jobId,
            userId,
            stream,
            messageId,
            'MANNEQUIN_WORKFLOW_NOT_CONFIGURED',
            jobLog,
            startedAt,
          );
          return;
        }
        if (!inputs.upperGarmentKey) {
          await markFailed(
            cfg,
            jobId,
            userId,
            stream,
            messageId,
            'MANNEQUIN_INPUTS_MISSING',
            jobLog,
            startedAt,
          );
          return;
        }
        try {
          effectiveUpperGarmentKey = await runMannequinPhase(cfg, {
            jobId,
            garmentKey: inputs.upperGarmentKey,
            faceId: inputs.faceId,
            mannequinWorkflowTemplateId: garmentTypeRow.mannequinWorkflowTemplateId,
            jobLog,
          });
        } catch (err) {
          jobLog.error({ err }, 'mannequin phase failed');
          const errMsg = err instanceof Error ? err.message : String(err);
          await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
          return;
        }
      }
    } else {
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
  const [tmplRoles] = await db
    .select({
      faceNodeId: schema.workflowTemplates.faceNodeId,
      bgNodeId: schema.workflowTemplates.bgNodeId,
      upperNodeIds: schema.workflowTemplates.upperNodeIds,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));
  const needsFace = !!tmplRoles?.faceNodeId;
  const needsBg = !!tmplRoles?.bgNodeId;
  const needsUpper = (tmplRoles?.upperNodeIds.length ?? 0) > 0;
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
    jobLog.info({ needsFace, needsBg, needsUpper }, 'uploading inputs to ComfyUI');
    const baseTasks: Promise<string>[] = [uploadToComfy(poseKey, 'pose')];
    if (needsUpper && effectiveUpperGarmentKey)
      baseTasks.push(uploadToComfy(effectiveUpperGarmentKey, 'garment'));
    if (needsFace) baseTasks.push(uploadToComfy(faceSideKey, 'face'));
    if (needsBg) baseTasks.push(uploadToComfy(bgKey, 'bg'));
    if (lowerKey) baseTasks.push(uploadToComfy(lowerKey, 'lower'));
    if (shoeKey) baseTasks.push(uploadToComfy(shoeKey, 'shoe'));
    if (inputs.thirdGarmentKey) baseTasks.push(uploadToComfy(inputs.thirdGarmentKey, 'third'));
    const uploaded = await Promise.all(baseTasks);

    let idx = 0;
    // biome-ignore lint/style/noNonNullAssertion: baseTasks always produces the pose entry first
    const poseFile = uploaded[idx++]!;
    const upperGarmentFile = needsUpper && effectiveUpperGarmentKey ? uploaded[idx++] : undefined;
    const faceSideFile = needsFace ? uploaded[idx++] : undefined;
    const backgroundFile = needsBg ? uploaded[idx++] : undefined;
    const lowerGarmentFile = lowerKey ? uploaded[idx++] : undefined;
    const shoeGarmentFile = shoeKey ? uploaded[idx++] : undefined;
    const thirdGarmentFile = inputs.thirdGarmentKey ? uploaded[idx++] : undefined;
    jobLog.info(
      {
        upperGarmentFile,
        faceSideFile,
        poseFile,
        backgroundFile,
        lowerGarmentFile,
        shoeGarmentFile,
        thirdGarmentFile,
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
        thirdGarmentFile,
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
          thirdGarmentFile,
          promptFacePhase: effectivePromptFacePhase ?? null,
          promptGarmentPhase: effectivePromptGarmentPhase ?? null,
          aspectRatio: jobAspectRatio ?? null,
          outputWidth: jobOutputWidth ?? null,
          outputHeight: jobOutputHeight ?? null,
          _r2Keys: {
            upperGarmentKey: inputs.upperGarmentKey,
            effectiveUpperGarmentKey,
            faceSideKey,
            poseKey,
            bgKey,
            bgSource,
            lowerKey,
            shoeKey,
            thirdGarmentKey: inputs.thirdGarmentKey,
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
    if (
      err instanceof Error &&
      /no .* image was provided|no .* garment image was provided/.test(err.message)
    ) {
      jobLog.error({ err: err.message }, 'missing garment input for a mapped workflow role');
      await setWorkerStatus(redis, w.id, 'IDLE');
      await markFailed(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'MISSING_GARMENT_INPUT',
        jobLog,
        startedAt,
      );
      return;
    }
    jobLog.error({ err }, 'job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

// ── Tryon direct job processor ────────────────────────────────────────────

async function processVideoJob(
  cfg: ProcessorConfig,
  jobId: string,
  rawParams: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, storage, s3, r2Bucket } = cfg;
  const sourceImageKey = rawParams.sourceImageKey as string;
  const prompt = rawParams.prompt as string;

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);

  try {
    const env = loadEnv();
    const { url: imageUrl } = await storage.presignGet(sourceImageKey, 900);

    await transitionJob(db, pub, jobId, userId, 'GENERATING', {}, jobLog);
    const { taskId } = await createVideoTask(
      env.PIXVERSE_API_BASE_URL,
      env.PIXVERSE_API_KEY ?? '',
      imageUrl,
      prompt,
      jobLog,
    );
    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'PIXVERSE_DISPATCH',
      payload: { taskId },
    });

    const videoUrl = await pollVideoTask(
      env.PIXVERSE_API_BASE_URL,
      env.PIXVERSE_API_KEY ?? '',
      taskId,
      env.PIXVERSE_POLL_INTERVAL_MS,
      env.PIXVERSE_POLL_TIMEOUT_MS,
    );

    await transitionJob(db, pub, jobId, userId, 'UPLOADING', {}, jobLog);
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoRes.ok) throw new Error(`failed to download PixVerse video: ${videoRes.status}`);
    const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

    const resultKey = keys.videoOutput(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: resultKey,
        Body: videoBytes,
        ContentType: 'video/mp4',
      }),
    );

    await transitionJob(db, pub, jobId, userId, 'COMPLETED', { resultKey }, jobLog);
    await redis.xack(stream, 'dispatcher-cg', messageId);
    recordJobOutcome('success', startedAt);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

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
  if (!garmentKey) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MISSING_GARMENT_INPUT',
      jobLog,
      startedAt,
    );
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

// ── Saree mannequin (step-1) job processor ─────────────────────────────────

type SareeMannequinJob = {
  id: string;
  attempts: number;
  createdAt: Date;
};

async function processSareeMannequinJob(
  cfg: ProcessorConfig,
  job: SareeMannequinJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  rawParams: Record<string, unknown>,
  userId: string,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;

  const garmentKey = inputs.upperGarmentKey;
  const faceId = inputs.faceId;
  const garmentTypeId = inputs.garmentTypeId;

  // Dev-API saree-mannequin jobs snapshot their resolved workflow template
  // directly into params and set garmentTypeId to null (they never touch
  // garment_subcategories) — see createDevSareeMannequinJob. garmentTypeId is
  // only needed as a fallback lookup key when no snapshot is present, so it
  // must not be required here when a snapshot already exists.
  const hasSnapshottedWorkflow = typeof rawParams.workflowTemplateId === 'string';

  if (!garmentKey || (!garmentTypeId && !hasSnapshottedWorkflow)) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  // A saree style, if the merchant picked one, snapshots its own mannequin
  // workflow template ID directly into params — takes precedence over the
  // garment type's default. See createMerchantSareeMannequinJob.
  const snapshottedWorkflowTemplateId =
    typeof rawParams.workflowTemplateId === 'string' ? rawParams.workflowTemplateId : null;

  let workflowTemplateId = snapshottedWorkflowTemplateId;
  if (!workflowTemplateId) {
    // No snapshot present — the guard above only allows this when
    // garmentTypeId is non-null, so this is the garment-type-default lookup
    // path. Re-checked explicitly (rather than relying on the guard above)
    // both to narrow the type for TS and as a defensive belt-and-braces check.
    if (!garmentTypeId) {
      await markFailed(
        cfg,
        jobId,
        userId,
        stream,
        messageId,
        'MANNEQUIN_INPUTS_MISSING',
        jobLog,
        startedAt,
      );
      return;
    }
    const [garmentType] = await db
      .select({
        mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      })
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));
    workflowTemplateId = garmentType?.mannequinWorkflowTemplateId ?? null;
  }
  if (!workflowTemplateId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_WORKFLOW_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  const [template] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      tryonPersonNodeId: schema.workflowTemplates.tryonPersonNodeId,
      tryonGarmentNodeId: schema.workflowTemplates.tryonGarmentNodeId,
      tryonGarmentNodeId2: schema.workflowTemplates.tryonGarmentNodeId2,
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
  const palluNodeId = template.tryonGarmentNodeId2;
  const outputNodeId = template.tryonOutputNodeId;
  if (!garmentNodeId || !outputNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  if (inputs.thirdGarmentKey && !palluNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }
  if (palluNodeId && !inputs.thirdGarmentKey) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  // Only templates with a person node need a caller-supplied face — templates
  // that bake the face in directly (e.g. a fixed URL node) have nothing to
  // resolve here regardless of what faceId arrived as.
  if (personNodeId && !faceId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  // Templates with no person node bake the face in directly (e.g. a fixed URL
  // node) — nothing to resolve or patch, faceId is accepted but unused.
  let personKey: string | undefined;
  if (personNodeId) {
    // Guarded above: personNodeId truthy implies faceId is non-null here.
    if (!faceId) {
      await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog, startedAt);
      return;
    }
    const [faceRow] = await db
      .select({ r2Key: schema.modelFaces.r2Key, faceSideR2Key: schema.modelFaces.faceSideR2Key })
      .from(schema.modelFaces)
      .where(eq(schema.modelFaces.id, faceId));
    if (!faceRow) {
      await markFailed(cfg, jobId, userId, stream, messageId, 'NO_FACE_IMAGE', jobLog, startedAt);
      return;
    }
    personKey = faceRow.faceSideR2Key ?? faceRow.r2Key;
  }

  await transitionJob(db, pub, jobId, userId, 'PREPROCESSING', {}, jobLog);

  const worker = await selectWorker(redis, 'saree');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn('no idle saree worker — mannequin job exceeded max queue wait, terminating');
      await terminateJob(cfg, jobId, userId, stream, messageId, 'NO_WORKER', 0, jobLog, startedAt);
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
  jobLog.info({ workerId: w.id }, 'worker claimed for saree mannequin');

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

    jobLog.info('uploading mannequin inputs to ComfyUI');
    const [personFile, garmentFile, palluFile] = await Promise.all([
      personKey ? uploadToComfy(personKey, 'mannequin_person') : Promise.resolve(undefined),
      uploadToComfy(garmentKey, 'mannequin_garment'),
      inputs.thirdGarmentKey
        ? uploadToComfy(inputs.thirdGarmentKey, 'mannequin_pallu')
        : Promise.resolve(undefined),
    ]);
    jobLog.info({ personFile, garmentFile, palluFile }, 'mannequin inputs uploaded');

    const workflow = structuredClone(template.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    if (personNodeId && personFile && workflow[personNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[personNodeId].inputs!.image = personFile;
    }
    if (workflow[garmentNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[garmentNodeId].inputs!.image = garmentFile;
    }
    if (palluNodeId && palluFile && workflow[palluNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[palluNodeId].inputs!.image = palluFile;
    }

    await transitionJob(db, pub, jobId, userId, 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'mannequin prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: {
          garmentKey,
          personKey,
          personFile,
          garmentFile,
          palluKey: inputs.thirdGarmentKey,
          palluFile,
        },
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
    if (!firstImage) throw new Error('ComfyUI returned no output images for mannequin job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    // Mannequin images are never delivered to the user — no watermark applies.
    await finalizeOutput({
      imageBytes,
      jobId,
      userId,
      jobWatermark: false,
      db,
      pub,
      s3,
      r2Bucket,
      jobLog,
    });
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info('mannequin job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'mannequin job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await handleFailure(cfg, jobId, userId, stream, messageId, jobLog, startedAt, errMsg);
  }
}

// ── Saree job processor (standalone feature, being retired — see Task 19 of
// the flat-saree-two-step-workflow plan) ───────────────────────────────────

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
  userId: string | null;
  merchantId: string | null;
  shopifyStoreId: string | null;
  customerPhotoKey: string | null;
  creditsCharged: number;
  createdAt: Date;
  watermark: boolean;
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
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;
  // biome-ignore lint/style/noNonNullAssertion: merchantId is guaranteed non-null for widget jobs
  const merchantId = job.merchantId!;
  const { creditsCharged } = job;

  // Shopify widget jobs: job_inputs.params.kind === 'shopify' — route to the dedicated
  // Shopify processor. Both branches below use the shared admin-managed worker pool
  // (selectWorker) rather than a fixed VPS — merchant/kiosk jobs used to depend on a
  // separate WIDGET_COMFYUI_URL/WIDGET_COMFYUI_BASIC_AUTH VPS that was never actually
  // provisioned, so every such job failed immediately with WIDGET_NOT_CONFIGURED.
  const rawParams =
    typeof inputs.params === 'string'
      ? (JSON.parse(inputs.params) as Record<string, unknown>)
      : ((inputs.params ?? {}) as Record<string, unknown>);
  if (rawParams.kind === 'shopify') {
    await processShopifyJob(cfg, job, inputs, rawParams, stream, messageId, jobLog, startedAt);
    return;
  }

  if (!job.customerPhotoKey) {
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
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
  if (!inputs.upperGarmentKey) {
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      'MISSING_GARMENT_INPUT',
      jobLog,
      startedAt,
    );
    return;
  }
  const upperGarmentKey = inputs.upperGarmentKey;

  // Resolve the per-job tryon workflow template — kiosk resolves this at job-creation
  // time via garment type -> tryon_categories -> workflow_templates, the SAME mechanism
  // the studio Try-On feature uses (see createSimpleTryonJob). Not "any active widget
  // template" — the widget workflow category was retired in favor of tryon workflows.
  const workflowTemplateId = rawParams.workflowTemplateId as string | undefined;
  if (!workflowTemplateId) {
    jobLog.error(
      'kiosk job has no workflowTemplateId — garment type has no tryon category configured',
    );
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      'WIDGET_TEMPLATE_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  const [templateRow] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      tryonGarmentNodeId: schema.workflowTemplates.tryonGarmentNodeId,
      tryonPersonNodeId: schema.workflowTemplates.tryonPersonNodeId,
      tryonOutputNodeId: schema.workflowTemplates.tryonOutputNodeId,
    })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.id, workflowTemplateId),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  if (!templateRow) {
    jobLog.error({ workflowTemplateId }, 'resolved tryon workflow template not found or inactive');
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      'WIDGET_TEMPLATE_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  const garmentNodeId = templateRow.tryonGarmentNodeId;
  const customerPhotoNodeId = templateRow.tryonPersonNodeId;
  const outputNodeId = templateRow.tryonOutputNodeId;

  if (!garmentNodeId || !customerPhotoNodeId || !outputNodeId) {
    jobLog.error(
      { workflowTemplateId },
      'resolved tryon workflow template is missing node ID mappings',
    );
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      'TRYON_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  await transitionJob(db, pub, jobId, '', 'PREPROCESSING', {}, jobLog);

  // Merchant/kiosk widget jobs route to workers with 'merchant' in their allowedJobTypes
  // (or an empty allowedJobTypes, i.e. "accepts any") — the same admin-managed pool the
  // main studio flow and Shopify jobs use, via selectWorker. See processShopifyJob for
  // the precedent this mirrors.
  const worker = await selectWorker(redis, 'merchant');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn(
        'no idle merchant worker — job exceeded max queue wait, terminating with widget refund',
      );
      await markWidgetFailed(
        cfg,
        jobId,
        merchantId,
        creditsCharged,
        stream,
        messageId,
        'NO_WORKER',
        jobLog,
        startedAt,
      );
    } else {
      jobLog.warn('no idle merchant worker — re-enqueuing with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for merchant widget job');

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

    jobLog.info('uploading merchant widget inputs to ComfyUI');
    const [garmentFilename, customerPhotoFilename] = await Promise.all([
      uploadToComfy(upperGarmentKey, 'merchant_garment'),
      uploadToComfy(customerPhotoKey, 'merchant_customer'),
    ]);
    jobLog.info({ garmentFilename, customerPhotoFilename }, 'merchant widget inputs uploaded');

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

    await transitionJob(db, pub, jobId, '', 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'merchant widget prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { customerPhotoKey, upperGarmentKey, customerPhotoFilename, garmentFilename },
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

    await transitionJob(db, pub, jobId, '', 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, outputNodeId);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for merchant widget job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    // Upload result to R2 as WebP (q90) — smaller payload for the merchant/kiosk clients.
    const resultKey = `widget-outputs/${jobId}/result.webp`;
    const webpBuffer = await sharp(imageBytes).webp({ quality: 90 }).toBuffer();
    await s3.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: resultKey,
        Body: webpBuffer,
        ContentType: 'image/webp',
      }),
    );

    // Mark COMPLETED (transitionJob handles DB + admin SSE; publish widget channel separately)
    await transitionJob(db, pub, jobId, '', 'COMPLETED', { resultKey }, jobLog);
    await pub.publish(
      `sse:events:widget:${merchantId}`,
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
      'merchantId',
      merchantId,
      'status',
      'COMPLETED',
      'resultKey',
      resultKey,
    );
    await redis.xack(stream, 'dispatcher-cg', messageId);
    await setWorkerStatus(redis, w.id, 'IDLE');
    recordJobOutcome('success', startedAt);
    jobLog.info({ resultKey }, 'widget job completed successfully');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    jobLog.error({ err }, 'widget job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    await markWidgetFailed(
      cfg,
      jobId,
      merchantId,
      creditsCharged,
      stream,
      messageId,
      errMsg.slice(0, 1000),
      jobLog,
      startedAt,
    );
  }
}

// ── Shopify job processor ──────────────────────────────────────────────────
//
// Shopify jobs are widget jobs (shopifyStoreId set, real userId set, routed
// through processWidgetJob) but they use the shared GPU worker pool — the exact
// ComfyUI/patcher/upload helpers imported at the top of this file — instead of
// the dedicated widget ComfyUI VPS. Structurally this mirrors processSareeJob:
// load one workflow_templates row by ID and reuse its tryon*_node_id columns
// (tryonPersonNodeId = customer photo node, tryonGarmentNodeId = garment node,
// tryonOutputNodeId = output node) — the same "reuse the generic tryon* columns
// for a non-tryon job kind" precedent saree established. Failure handling
// follows the same pattern: no MAX_ATTEMPTS retry-then-terminate —
// any terminal failure goes straight to markShopifyFailed (user credit refund).

async function processShopifyJob(
  cfg: ProcessorConfig,
  job: WidgetJob,
  inputs: typeof schema.jobInputs.$inferSelect,
  params: Record<string, unknown>,
  stream: string,
  messageId: string,
  jobLog: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub, s3, r2Bucket } = cfg;
  const jobId = job.id;
  // biome-ignore lint/style/noNonNullAssertion: userId/shopifyStoreId guaranteed non-null for shopify jobs routed through this path
  const userId = job.userId!;
  // biome-ignore lint/style/noNonNullAssertion: userId/shopifyStoreId guaranteed non-null for shopify jobs routed through this path
  const shopifyStoreId = job.shopifyStoreId!;
  const { creditsCharged } = job;

  const garmentKey = inputs.upperGarmentKey;
  const customerPhotoKey = job.customerPhotoKey;

  const [garmentRow] = await db
    .select({
      funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
    })
    .from(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.r2Key, garmentKey ?? ''))
    .limit(1);

  let workflowTemplateId: string | undefined;
  if (garmentRow?.funnelTemplateId) {
    const [funnelTemplate] = await db
      .select({ workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId })
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, garmentRow.funnelTemplateId));
    workflowTemplateId = funnelTemplate?.workflowTemplateId;
  }
  if (!workflowTemplateId) {
    workflowTemplateId = params.workflowTemplateId as string | undefined;
  }

  if (!workflowTemplateId || !garmentKey || !customerPhotoKey) {
    await markShopifyFailed(
      cfg,
      jobId,
      userId,
      shopifyStoreId,
      creditsCharged,
      stream,
      messageId,
      !workflowTemplateId ? 'NO_WORKFLOW_CONFIGURED' : 'SHOPIFY_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  // Load Shopify workflow template. Shopify flows reuse the tryon*_node_id columns
  // on workflow_templates (same precedent processSareeJob established).
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
    await markShopifyFailed(
      cfg,
      jobId,
      userId,
      shopifyStoreId,
      creditsCharged,
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
    await markShopifyFailed(
      cfg,
      jobId,
      userId,
      shopifyStoreId,
      creditsCharged,
      stream,
      messageId,
      'SHOPIFY_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  await transitionJob(db, pub, jobId, '', 'PREPROCESSING', {}, jobLog);

  // Shopify jobs route to workers with 'shopify' in their allowedJobTypes. An admin
  // must configure at least one such worker (or one with an empty allowedJobTypes,
  // i.e. "accepts any") for these jobs to ever be picked up — see selectWorker.
  const worker = await selectWorker(redis, 'shopify');
  if (!worker) {
    if (Date.now() - job.createdAt.getTime() > MAX_QUEUE_WAIT_MS) {
      jobLog.warn(
        'no idle shopify worker — job exceeded max queue wait, terminating with widget refund',
      );
      await markShopifyFailed(
        cfg,
        jobId,
        userId,
        shopifyStoreId,
        creditsCharged,
        stream,
        messageId,
        'NO_WORKER',
        jobLog,
        startedAt,
      );
    } else {
      jobLog.warn('no idle shopify worker — re-enqueuing with backoff');
      await db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, jobId));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId);
      await redis.xack(stream, 'dispatcher-cg', messageId);
      recordJobOutcome('retried', startedAt);
    }
    return;
  }
  const w = worker;
  jobLog.info({ workerId: w.id }, 'worker claimed for shopify');

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

    jobLog.info('uploading shopify inputs to ComfyUI');
    const [customerPhotoFile, garmentFile] = await Promise.all([
      uploadToComfy(customerPhotoKey, 'shopify_customer'),
      uploadToComfy(garmentKey, 'shopify_garment'),
    ]);
    jobLog.info({ customerPhotoFile, garmentFile }, 'shopify inputs uploaded');

    // Clone and patch workflow
    const workflow = structuredClone(template.jsonContent) as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    if (workflow[personNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[personNodeId].inputs!.image = customerPhotoFile;
    }
    if (workflow[garmentNodeId]?.inputs) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by optional-chain check above
      workflow[garmentNodeId].inputs!.image = garmentFile;
    }

    await transitionJob(db, pub, jobId, '', 'GENERATING', { workerId: w.id }, jobLog);
    const clientUuid = randomUUID();
    const comfyStartedAt = Date.now();
    const { promptId } = await submitPrompt(w.url, w.apiKey, clientUuid, workflow, jobLog);
    jobLog.info({ promptId }, 'shopify prompt submitted');

    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        promptId,
        workerId: w.id,
        workerUrl: w.url,
        workflowTemplateId,
        inputs: { customerPhotoKey, garmentKey, customerPhotoFile, garmentFile },
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

    await transitionJob(db, pub, jobId, '', 'UPLOADING', {}, jobLog);
    const outputImages = await fetchHistory(w.url, w.apiKey, promptId, jobLog, outputNodeId);
    const [firstImage] = outputImages;
    if (!firstImage) throw new Error('ComfyUI returned no output images for shopify job');

    const imageBytes = await downloadOutputImage(w.url, w.apiKey, firstImage.filename);

    const { resultKey } = await finalizeOutput({
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
    jobLog.info({ resultKey }, 'shopify job completed successfully');
  } catch (err) {
    jobLog.error({ err }, 'shopify job processing error');
    await setWorkerStatus(redis, w.id, 'IDLE');
    const errMsg = err instanceof Error ? err.message : String(err);
    await markShopifyFailed(
      cfg,
      jobId,
      userId,
      shopifyStoreId,
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
  merchantId: string,
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
      .from(schema.merchantCreditLedger)
      .where(
        and(
          eq(schema.merchantCreditLedger.jobId, jobId),
          eq(schema.merchantCreditLedger.reason, 'JOB_FAIL_REFUND'),
        ),
      );
    if (existing.length) return;
    await tx
      .update(schema.merchantCredits)
      .set({ balance: sql`${schema.merchantCredits.balance} + ${creditsCharged}` })
      .where(eq(schema.merchantCredits.merchantId, merchantId));
    await tx
      .insert(schema.merchantCreditLedger)
      .values({ merchantId, delta: creditsCharged, reason: 'JOB_FAIL_REFUND', jobId });
  });

  await transitionJob(db, pub, jobId, '', 'FAILED', { errorCode }, log);
  await pub.publish(
    `sse:events:widget:${merchantId}`,
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
    'merchantId',
    merchantId,
    'status',
    'FAILED',
    'errorCode',
    errorCode,
  );
  await redis.xack(stream, 'dispatcher-cg', messageId);
  recordJobOutcome('failed', startedAt);
  log.warn({ jobId, errorCode }, 'widget job FAILED — widget credits refunded');
}

async function markShopifyFailed(
  cfg: ProcessorConfig,
  jobId: string,
  userId: string,
  shopifyStoreId: string,
  creditsCharged: number,
  stream: string,
  messageId: string,
  errorCode: string,
  log: Logger,
  startedAt: number,
): Promise<void> {
  const { db, redis, pub } = cfg;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.creditLedger)
      .where(
        and(
          eq(schema.creditLedger.jobId, jobId),
          eq(schema.creditLedger.reason, 'JOB_FAIL_REFUND'),
        ),
      );
    if (existing.length) return;
    await tx
      .update(schema.userCredits)
      .set({ balance: sql`${schema.userCredits.balance} + ${creditsCharged}` })
      .where(eq(schema.userCredits.userId, userId));
    await tx
      .insert(schema.creditLedger)
      .values({ userId, delta: creditsCharged, reason: 'JOB_FAIL_REFUND', jobId });
  });

  await transitionJob(db, pub, jobId, userId, 'FAILED', { errorCode }, log);
  await redis.xack(stream, 'dispatcher-cg', messageId);
  recordJobOutcome('failed', startedAt);
  log.warn({ jobId, shopifyStoreId, errorCode }, 'shopify job FAILED — user credits refunded');
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
    // A conflict (already refunded, e.g. this job was retried via admin after a prior
    // terminal fail) must only skip the balance update — the status transition below
    // still has to run, or the job is left orphaned in a non-terminal status forever.
    if (creditsCharged > 0) {
      const inserted = await tx
        .insert(schema.creditLedger)
        .values({ userId, delta: creditsCharged, reason: 'JOB_FAIL_REFUND', jobId })
        .onConflictDoNothing()
        .returning({ id: schema.creditLedger.id });
      if (inserted.length) {
        await tx
          .update(schema.userCredits)
          .set({ balance: sql`${schema.userCredits.balance} + ${creditsCharged}` })
          .where(eq(schema.userCredits.userId, userId));
      }
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
  const { db, redis } = cfg;

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
