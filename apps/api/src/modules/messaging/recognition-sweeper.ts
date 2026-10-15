import { schema } from '@aivastra/db';
import { lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// D54: recognition rows are an inspection aid, not an audit trail —
// the photo's lifecycle stays with the upload sweeper, only the rows expire.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes garment_recognitions rows older than 30 days. Rows only; the
 * garment photo belongs to the upload sweeper.
 */
export async function runRecognitionSweepTick(
  app: FastifyInstance,
  opts: { maxAgeMs?: number } = {},
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - (opts.maxAgeMs ?? RETENTION_MS));
  const deleted = await app.db
    .delete(schema.garmentRecognitions)
    .where(lt(schema.garmentRecognitions.createdAt, cutoff))
    .returning({ id: schema.garmentRecognitions.id });
  app.log.info({ deleted: deleted.length }, 'recognition sweeper tick complete');
  return { deleted: deleted.length };
}

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Call once after `app.listen(...)`. Returns a stop function so tests can
 *  tear the interval down. */
export function startRecognitionSweeper(
  app: FastifyInstance,
  intervalMs: number = SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('recognition sweeper tick still running — skipping this interval');
      return;
    }
    running = true;
    void runRecognitionSweepTick(app)
      .catch((err) => {
        app.log.error({ err }, 'recognition sweeper tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
