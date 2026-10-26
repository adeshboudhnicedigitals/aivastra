import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// SEC-H4: presignPut cannot enforce contentLength (see packages/storage/src/r2.ts),
// so a caller can PUT an arbitrarily large file to a key that never becomes a job.
// The upload:owner:<key> Redis binding already expires after 24h, so 24h is the
// natural cutoff for treating an unreferenced object as abandoned rather than
// "job creation just hasn't happened yet".
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes objects under inputs/ that are older than 24h and are not referenced
 * by any job_inputs row (all four garment keys or params.personKey), or by
 * jobs.customerPhotoKey. Every garment column can
 * hold an inputs/ key — each garment slot gets its own /v1/uploads/presign call
 * and therefore its own inputs/<token>/garment.jpg key. Video jobs instead keep
 * their uploaded image in params.sourceImageKey; it doubles as the card thumbnail
 * and the "Input" image on the results page, so it is protected too.
 */
export async function runUploadSweepTick(
  app: FastifyInstance,
  opts: { maxAgeMs?: number } = {},
): Promise<{ scanned: number; deleted: number }> {
  const objects = await app.storage.listObjects(keys.inputGarmentPrefix());
  const cutoff = Date.now() - (opts.maxAgeMs ?? ORPHAN_AGE_MS);
  const candidates = objects.filter((o) => (o.lastModified?.getTime() ?? 0) < cutoff);
  if (candidates.length === 0) {
    return { scanned: objects.length, deleted: 0 };
  }

  const candidateKeys = candidates.map((c) => c.key);
  const referenced = await app.db
    .select({
      upperGarmentKey: schema.jobInputs.upperGarmentKey,
      lowerGarmentKey: schema.jobInputs.lowerGarmentKey,
      thirdGarmentKey: schema.jobInputs.thirdGarmentKey,
      fourthGarmentKey: schema.jobInputs.fourthGarmentKey,
    })
    .from(schema.jobInputs)
    .where(
      or(
        inArray(schema.jobInputs.upperGarmentKey, candidateKeys),
        inArray(schema.jobInputs.lowerGarmentKey, candidateKeys),
        inArray(schema.jobInputs.thirdGarmentKey, candidateKeys),
        inArray(schema.jobInputs.fourthGarmentKey, candidateKeys),
      ),
    );
  // Not a garment column: video jobs (params.kind = 'video') snapshot the image they
  // animate here. Without this check the sweeper deleted every video source after 24h,
  // leaving the card thumbnail 404ing (presignGet signs locally and never notices).
  const sourceImageKey = sql<string>`${schema.jobInputs.params}->>'sourceImageKey'`;
  const personKey = sql<string>`${schema.jobInputs.params}->>'personKey'`;
  const referencedAsPerson = await app.db
    .select({ key: personKey })
    .from(schema.jobInputs)
    .where(inArray(personKey, candidateKeys));
  const referencedAsCustomerPhoto = await app.db
    .select({ key: schema.jobs.customerPhotoKey })
    .from(schema.jobs)
    .where(inArray(schema.jobs.customerPhotoKey, candidateKeys));
  const referencedAsSource = await app.db
    .select({ key: sourceImageKey })
    .from(schema.jobInputs)
    .where(inArray(sourceImageKey, candidateKeys));
  const referencedKeys = new Set<string | null>([
    ...referenced.flatMap((r) => [
      r.upperGarmentKey,
      r.lowerGarmentKey,
      r.thirdGarmentKey,
      r.fourthGarmentKey,
    ]),
    ...referencedAsSource.map((r) => r.key),
    ...referencedAsPerson.map((r) => r.key),
    ...referencedAsCustomerPhoto.map((r) => r.key),
  ]);

  let deleted = 0;
  for (const key of candidateKeys) {
    if (referencedKeys.has(key)) continue;
    try {
      await app.storage.deleteObject(key);
      deleted++;
    } catch (err) {
      app.log.error({ err, key }, 'upload sweeper: failed to delete orphaned object');
    }
  }
  app.log.info(
    { scanned: objects.length, candidates: candidates.length, deleted },
    'upload sweeper tick complete',
  );
  return { scanned: objects.length, deleted };
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Call once after `app.listen(...)`. Returns a stop function so tests can
 *  tear the interval down. */
export function startUploadSweeper(
  app: FastifyInstance,
  intervalMs: number = SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('upload sweeper tick still running — skipping this interval');
      return;
    }
    running = true;
    void runUploadSweepTick(app)
      .catch((err) => {
        app.log.error({ err }, 'upload sweeper tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
