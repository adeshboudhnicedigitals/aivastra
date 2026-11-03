import { FLEET_RAW_RETENTION_MS } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// Small enough that one DELETE never holds locks for long, large enough that a backlog clears in
// a few passes. A tick stops after MAX_BATCHES and the next interval carries on, so a flood of
// old rows (an agent replaying a long spool, a retention outage) cannot make one tick unbounded.
const BATCH_SIZE = 5000;
const MAX_BATCHES = 40;
const TICK_INTERVAL_MS = 10 * 60 * 1000;

const TABLES = ['fleet_gpu_samples', 'fleet_host_samples'] as const;

async function deleteBatch(
  app: FastifyInstance,
  table: (typeof TABLES)[number],
  cutoff: Date,
  batch: number,
): Promise<number> {
  // Table names come from the constant above, never from input, so interpolating them is safe;
  // the values are bound parameters.
  const rows = await app.db.execute<{ n: number }>(sql`
    WITH gone AS (
      DELETE FROM ${sql.raw(table)}
      WHERE id IN (
        SELECT id FROM ${sql.raw(table)} WHERE observed_at < ${cutoff.toISOString()}::timestamptz ORDER BY observed_at LIMIT ${batch}
      )
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM gone
  `);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Deletes raw fleet samples older than the retention window. Idempotent and safe to run from
 * more than one process: a row already gone is simply not found. Only the sample tables are
 * touched; keys, audit rows and incidents are never retention-deleted here.
 */
export async function runFleetRetentionTick(
  app: FastifyInstance,
  opts: { maxAgeMs?: number; batchSize?: number; maxBatches?: number; now?: number } = {},
): Promise<{ deleted: Record<(typeof TABLES)[number], number>; complete: boolean }> {
  const cutoff = new Date((opts.now ?? Date.now()) - (opts.maxAgeMs ?? FLEET_RAW_RETENTION_MS));
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const maxBatches = opts.maxBatches ?? MAX_BATCHES;
  const deleted = { fleet_gpu_samples: 0, fleet_host_samples: 0 };
  let complete = true;
  for (const table of TABLES) {
    for (let i = 0; i < maxBatches; i++) {
      const n = await deleteBatch(app, table, cutoff, batchSize);
      deleted[table] += n;
      if (n < batchSize) break;
      // A full batch on the last allowed pass means there may be more left for the next tick.
      if (i === maxBatches - 1) complete = false;
    }
  }
  const total = deleted.fleet_gpu_samples + deleted.fleet_host_samples;
  if (total > 0) app.log.info({ deleted, complete }, 'fleet retention tick complete');
  return { deleted, complete };
}

/** Call once after `app.listen(...)`. Returns a stop function so tests can tear the timer down. */
export function startFleetRetention(
  app: FastifyInstance,
  intervalMs: number = TICK_INTERVAL_MS,
): () => void {
  let running = false;
  const tick = () => {
    if (running) {
      app.log.warn('fleet retention tick still running — skipping this interval');
      return;
    }
    running = true;
    void runFleetRetentionTick(app)
      .catch((err) => app.log.error({ err }, 'fleet retention tick failed'))
      .finally(() => {
        running = false;
      });
  };
  // Also once at boot, so a restart after a long outage does not wait a full interval.
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
