import { FLEET_RAW_RETENTION_MS, FLEET_ROLLUP_RETENTION_MS } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// Folds raw samples into 1-minute rollups before retention deletes them (raw 48 h, rollups 30 d).
//
// Idempotent by construction: each pass recomputes every minute in its window from the raw rows
// and upserts, so a late spooled sample, a restart, or two api processes running the same pass
// all converge on the same rows. The current, still-filling minute is included, so charts have no
// hole at the right edge.
//
// The window must stay inside the raw retention. A minute whose raw rows are partly deleted would
// be recomputed from the remainder and overwrite a good rollup with a thin one, so the backfill
// stops an hour short of the cutoff.

const TICK_INTERVAL_MS = 60 * 1000;
const STEADY_LOOKBACK_MS = 30 * 60 * 1000;
const BACKFILL_LOOKBACK_MS = FLEET_RAW_RETENTION_MS - 60 * 60 * 1000;

async function rollupGpu(app: FastifyInstance, since: Date): Promise<void> {
  await app.db.execute(sql`
    INSERT INTO fleet_gpu_rollups
      (worker_id, gpu_index, bucket, n, temp_avg, temp_max, sm_clock_avg, sm_clock_min,
       power_avg, power_max, util_avg, vram_used_max, vram_total_max)
    SELECT worker_id, gpu_index, date_trunc('minute', observed_at), count(*)::int,
           avg(temp_c), max(temp_c), avg(sm_clock_mhz), min(sm_clock_mhz),
           avg(power_w), max(power_w), avg(util_gpu_pct), max(vram_used_mib), max(vram_total_mib)
    FROM fleet_gpu_samples
    WHERE observed_at >= ${since.toISOString()}::timestamptz
    GROUP BY worker_id, gpu_index, date_trunc('minute', observed_at)
    ON CONFLICT (worker_id, gpu_index, bucket) DO UPDATE SET
      n = EXCLUDED.n, temp_avg = EXCLUDED.temp_avg, temp_max = EXCLUDED.temp_max,
      sm_clock_avg = EXCLUDED.sm_clock_avg, sm_clock_min = EXCLUDED.sm_clock_min,
      power_avg = EXCLUDED.power_avg, power_max = EXCLUDED.power_max,
      util_avg = EXCLUDED.util_avg, vram_used_max = EXCLUDED.vram_used_max,
      vram_total_max = EXCLUDED.vram_total_max
  `);
}

async function rollupHost(app: FastifyInstance, since: Date): Promise<void> {
  await app.db.execute(sql`
    INSERT INTO fleet_host_rollups
      (worker_id, bucket, n, load1_max, ram_avail_min, swap_used_max, mem_psi_max)
    SELECT worker_id, date_trunc('minute', observed_at), count(*)::int,
           max(load1), min(ram_avail_mib), max(swap_used_mib), max(mem_psi_some10)
    FROM fleet_host_samples
    WHERE observed_at >= ${since.toISOString()}::timestamptz
    GROUP BY worker_id, date_trunc('minute', observed_at)
    ON CONFLICT (worker_id, bucket) DO UPDATE SET
      n = EXCLUDED.n, load1_max = EXCLUDED.load1_max, ram_avail_min = EXCLUDED.ram_avail_min,
      swap_used_max = EXCLUDED.swap_used_max, mem_psi_max = EXCLUDED.mem_psi_max
  `);
}

export async function runFleetRollupTick(
  app: FastifyInstance,
  opts: { lookbackMs?: number; now?: number } = {},
): Promise<{ deletedOld: number }> {
  const now = opts.now ?? Date.now();
  // Align to a whole minute so the first bucket is never a fragment of a minute.
  const since = new Date(
    Math.floor((now - (opts.lookbackMs ?? STEADY_LOOKBACK_MS)) / 60_000) * 60_000,
  );
  await rollupGpu(app, since);
  await rollupHost(app, since);

  const cutoff = new Date(now - FLEET_ROLLUP_RETENTION_MS).toISOString();
  const gone = await app.db.execute<{ n: number }>(sql`
    WITH a AS (DELETE FROM fleet_gpu_rollups WHERE bucket < ${cutoff}::timestamptz RETURNING 1),
         b AS (DELETE FROM fleet_host_rollups WHERE bucket < ${cutoff}::timestamptz RETURNING 1)
    SELECT ((SELECT count(*) FROM a) + (SELECT count(*) FROM b))::int AS n
  `);
  return { deletedOld: Number(gone[0]?.n ?? 0) };
}

/**
 * Call once after `app.listen(...)`. The first pass backfills the whole raw window, so a deploy
 * (or an outage of this loop) never leaves a hole that retention would then make permanent.
 */
export function startFleetRollups(
  app: FastifyInstance,
  intervalMs: number = TICK_INTERVAL_MS,
): () => void {
  let running = false;
  let first = true;
  const tick = () => {
    if (running) {
      app.log.warn('fleet rollup tick still running — skipping this interval');
      return;
    }
    running = true;
    const lookbackMs = first ? BACKFILL_LOOKBACK_MS : STEADY_LOOKBACK_MS;
    void runFleetRollupTick(app, { lookbackMs })
      .then(() => {
        first = false;
      })
      .catch((err) => app.log.error({ err }, 'fleet rollup tick failed'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
