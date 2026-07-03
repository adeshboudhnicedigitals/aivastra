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
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Redis } from 'ioredis';
import { transitionJob } from '../job/state.js';

export interface FinalizeOutputOpts {
  /** Raw image bytes downloaded from ComfyUI. */
  imageBytes: Uint8Array;
  jobId: string;
  userId: string;
  /** Whether this job has the watermark flag set (snapshotted at creation). */
  jobWatermark: boolean;
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

  // Step 4 will conditionally apply WatermarkService here when ENABLE_WATERMARKING is on.
  // For now, the buffer is used as-is.
  const finalBuffer = imageBytes;
  const watermarkApplied = false;
  const watermarkVersion: number | null = null;

  // Upload result to R2
  const resultKey = keys.output(jobId);
  await s3.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: resultKey,
      Body: finalBuffer,
      ContentType: 'image/png',
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
    { resultKey, thumbnailKey, skipOutputInsert: true },
    jobLog,
  );

  return { resultKey, thumbnailKey };
}
