import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { JOB_SOURCE } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

/** Matches /v1/uploads/presign's binding TTL — see apps/api/src/modules/uploads/routes.ts. */
const UPLOAD_OWNER_TTL_SEC = 24 * 60 * 60;

/**
 * Lets a caller use a completed Fabric to Garment job's generated image as the
 * `upperGarmentKey` of a normal /v1/jobs/tryon call — the Studio-style flow
 * the Fabric to Garment page continues into once generation finishes.
 *
 * Two separate obstacles block feeding a job's output key straight into
 * /v1/jobs/tryon, both left untouched here:
 *  - `upperGarmentKey`'s public zod schema (INPUT_GARMENT_KEY, jobs.ts) only
 *    accepts the `inputs/<uuid>/garment.jpg` shape a presigned upload
 *    produces — a job's result lives at `outputs/<jobId>/result.png` and
 *    would fail that regex before any ownership check ran.
 *  - verifyGarmentKey -> assertOwnsUploadKey only accepts a key bound in
 *    Redis by /v1/uploads/presign.
 * So this copies the result object to a fresh `inputs/<uuid>/garment.jpg`
 * key (the exact shape/convention presign itself uses — key extension is
 * already routinely unrelated to actual content type on that path, e.g. a
 * real PNG/WebP upload also lands at a `.jpg`-suffixed key) and binds that
 * new key's ownership, so it passes the existing, unmodified checks exactly
 * like a fresh upload would. Not idempotent on the returned key — each call
 * makes a new copy — but harmless to call more than once since no credits
 * are involved; the frontend should only call it once per completed job.
 */
export async function claimFabricToGarmentResult(
  app: FastifyInstance,
  userId: string,
  jobId: string,
): Promise<{ garmentKey: string }> {
  const [job] = await app.db
    .select({
      userId: schema.jobs.userId,
      status: schema.jobs.status,
      source: schema.jobs.source,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job || job.userId !== userId) {
    throw new AppError('FORBIDDEN', 403, 'job not owned by caller');
  }
  if (job.source !== JOB_SOURCE.FABRIC_TO_GARMENT) {
    throw new AppError('VALIDATION', 400, 'job is not a fabric-to-garment generation job');
  }
  if (job.status !== 'COMPLETED') {
    throw new AppError('VALIDATION', 400, 'fabric-to-garment generation not yet complete');
  }

  const resultBytes = await app.storage.getObject(keys.output(jobId));
  const garmentKey = keys.inputGarment(randomUUID());
  await app.storage.putObject(garmentKey, resultBytes, 'image/png');
  await app.redis.set(`upload:owner:${garmentKey}`, userId, 'EX', UPLOAD_OWNER_TTL_SEC);
  return { garmentKey };
}
