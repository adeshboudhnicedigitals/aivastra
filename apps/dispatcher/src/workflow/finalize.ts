/**
 * finalizeOutput — shared helper called by all three job processors
 * (processJob, processTryonDirectJob, processSareeJob) after ComfyUI
 * produces its result image.
 *
 * Responsibility:
 *   1. Upload the raw image buffer to R2 at keys.output(jobId).
 *   2. Generate a 512-px thumbnail from the same buffer.
 *   3. Upload the thumbnail to keys.outputThumb(jobId).
 *   4. Write job_outputs row (assetKind, watermarkVersion) — currently always ORIGINAL.
 *   5. Transition the job to COMPLETED.
 *
 * Step 2 of 7 — pure refactor, no watermarking behavior yet.
 * Watermarking will be wired in at step 4 behind ENABLE_WATERMARKING env var.
 */
import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { keys } from '@aivastra/storage';
import type { ImageCompressionJobConfig } from '@aivastra/types';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { loadEnv } from '../env.js';
import { transitionJob } from '../job/state.js';
import { applyWatermark, WATERMARK_VERSION } from './watermark.js';

const WEBP_QUALITY: Record<Exclude<ImageCompressionJobConfig['level'], 'lossless'>, number> = {
  q95: 95,
  q90: 90,
  q85: 85,
  q80: 80,
};

/**
 * Shared sharp re-encode used by every code path that writes a job's final
 * image — not just finalizeOutput below. processWidgetJob's merchant/kiosk
 * branch (apps/dispatcher/src/job/processor.ts) uploads its own result key
 * outside of finalizeOutput's job_outputs/thumbnail bookkeeping, but must
 * still honor the same per-job-type compression config, so it calls this
 * directly rather than duplicating the level→quality mapping.
 */
export async function encodeCompressedImage(
  buffer: Uint8Array,
  compression: ImageCompressionJobConfig | undefined,
): Promise<{ buffer: Uint8Array; format: 'png' | 'webp'; contentType: string }> {
  if (!compression?.enabled) {
    return { buffer, format: 'png', contentType: 'image/png' };
  }
  const encoded =
    compression.level === 'lossless'
      ? await sharp(buffer).webp({ lossless: true }).toBuffer()
      : await sharp(buffer).webp({ quality: WEBP_QUALITY[compression.level] }).toBuffer();
  return { buffer: encoded, format: 'webp', contentType: 'image/webp' };
}

export interface FinalizeOutputOpts {
  /** Raw image bytes downloaded from ComfyUI. */
  imageBytes: Uint8Array;
  jobId: string;
  userId: string;
  shopifyStoreId?: string;
  /** Whether this job has the watermark flag set (snapshotted at creation). */
  jobWatermark: boolean;
  /**
   * Per-job-type compression setting, resolved by the caller via
   * apps/dispatcher/src/config/image-compression.ts. Not enabled → PNG
   * passthrough (today's default). Enabled → sharp WebP re-encode at the
   * configured level.
   */
  compression?: ImageCompressionJobConfig;
  db: DB;
  pub: Redis;
  s3: S3Client;
  r2Bucket: string;
  jobLog: Logger;
}

/**
 * Upload result + thumbnail, write job_outputs, transition to COMPLETED.
 *
 * Returns the { resultKey, thumbnailKey } written to R2.
 */
export async function finalizeOutput(opts: FinalizeOutputOpts): Promise<{
  resultKey: string;
  thumbnailKey: string | undefined;
}> {
  const { imageBytes, jobId, userId, db, pub, s3, r2Bucket, jobLog } = opts;
  const finalizeStartedAt = Date.now();

  const env = loadEnv();

  let finalBuffer: Uint8Array = imageBytes;
  let watermarkApplied = false;
  let watermarkVersion: number | null = null;

  if (opts.jobWatermark) {
    if (env.ENABLE_WATERMARKING) {
      finalBuffer = await applyWatermark({ image: imageBytes, jobId });
      watermarkApplied = true;
      watermarkVersion = WATERMARK_VERSION;
    } else {
      jobLog.warn(
        {
          stage: 'watermark',
          jobId,
          expectedWatermark: true,
          appliedWatermark: false,
          reason: 'ENABLE_WATERMARKING_DISABLED',
        },
        'watermark disabled by kill switch',
      );
    }
  }

  // Upload result to R2
  const {
    buffer: resultBuffer,
    format: outputFormat,
    contentType,
  } = await encodeCompressedImage(finalBuffer, opts.compression);
  const resultKey = keys.output(jobId, outputFormat);
  await s3.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: resultKey,
      Body: resultBuffer,
      ContentType: contentType,
    }),
  );

  // Generate and upload thumbnail (512px, JPEG) from the final buffer.
  // Thumbnail is always generated from the final buffer — not the pre-watermark original.
  let thumbnailKey: string | undefined;
  try {
    const metadata = await sharp(finalBuffer).metadata();
    const thumbBytes = await sharp(finalBuffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    thumbnailKey = keys.outputThumb(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: thumbnailKey,
        Body: thumbBytes,
        ContentType: 'image/jpeg',
      }),
    );
    jobLog.info(
      {
        stage: 'watermark',
        jobId,
        watermarkApplied,
        watermarkVersion,
        processingTimeMs: Date.now() - finalizeStartedAt,
        imageWidth: metadata.width,
        imageHeight: metadata.height,
        imageSizeBytes: finalBuffer.byteLength,
        outputFormat: metadata.format,
      },
      'finalizeOutput complete',
    );
  } catch (thumbErr) {
    jobLog.warn({ err: thumbErr }, 'thumbnail generation failed — proceeding without thumbnail');
    thumbnailKey = undefined;
  }

  // Write job_outputs with asset_kind and watermark_version.
  // asset_kind reflects what actually ran — currently always ORIGINAL.
  const assetKind = watermarkApplied ? 'WATERMARKED' : 'ORIGINAL';
  await db
    .insert(schema.jobOutputs)
    .values({
      jobId,
      resultKey,
      thumbnailKey: thumbnailKey ?? null,
      assetKind,
      watermarkVersion: watermarkVersion !== null ? watermarkVersion : undefined,
    })
    .onConflictDoUpdate({
      target: schema.jobOutputs.jobId,
      set: {
        resultKey,
        thumbnailKey: thumbnailKey ?? null,
        assetKind,
        watermarkVersion: watermarkVersion !== null ? watermarkVersion : null,
      },
    });

  // Transition to COMPLETED — resultKey/thumbnailKey are included for SSE payload.
  // skipOutputInsert=true because we already upserted job_outputs above with assetKind/watermarkVersion.
  await transitionJob(
    db,
    pub,
    jobId,
    userId,
    'COMPLETED',
    { resultKey, thumbnailKey, skipOutputInsert: true, shopifyStoreId: opts.shopifyStoreId },
    jobLog,
  );

  return { resultKey, thumbnailKey };
}
