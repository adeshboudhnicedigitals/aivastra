import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// Analytics phase 1, plan Task 5: analytics_events + finished in-store jobs → 15-minute
// analytics_buckets (plan D3: IST is UTC+5:30, so the bucket must be finer than an hour).
//
// Each tick rebuilds only the (merchant, bucket) pairs that changed since the watermark:
// events by received_at (so a late offline upload still lands in the bucket of its
// occurred_at), jobs by completed_at. A rebuilt bucket is deleted and re-aggregated from
// source, never incremented, so re-running a tick is harmless.
//
// Try-on outcomes are DERIVED here from jobs, not emitted (plan D1): the dispatcher's
// settlement transaction carries no analytics write. jobs has no completed_at index, and
// none is added (building one on production's jobs would block writes); every jobs read
// here is narrowed by `session_id is not null`, which jobs_session_idx covers.
//
// ADVISORY: buckets are never read for a credit, limit or authorization decision.

const BUCKET = sql`interval '15 minutes'`;
// date_bin needs a fixed origin; any UTC quarter-hour works.
const ORIGIN = sql`timestamptz '2000-01-01 00:00:00+00'`;
const bin = (col: ReturnType<typeof sql>) => sql`date_bin(${BUCKET}, ${col}, ${ORIGIN})`;

/** Commit-skew lag: a row stamped just before T may still be uncommitted when T is read. */
const LAG_SECONDS = 60;
const TICK_INTERVAL_MS = 60_000;
/** A FAILED job can be retried (FAILED → QUEUED, apps/dispatcher/src/job/state.ts) and finish
 *  later in another bucket; the hourly safety pass rebuilds the trailing window to drop it. */
const SAFETY_TRAILING_HOURS = 48;
const SAFETY_EVERY_MS = 3_600_000;

export interface RollupResult {
  /** Another api process held the lock; nothing was done. */
  skipped: boolean;
  /** (merchant, bucket) pairs rebuilt. */
  rebuilt: number;
}

export async function runAnalyticsRollupTick(
  app: FastifyInstance,
  opts: { lagSeconds?: number; trailingHours?: number } = {},
): Promise<RollupResult> {
  const lag = opts.lagSeconds ?? LAG_SECONDS;
  const trailing = opts.trailingHours ?? 0;

  return app.db.transaction(async (tx) => {
    // Two api replicas must not rebuild the same bucket concurrently and double-insert.
    // xact lock: released at commit/rollback, so a crashed tick can never hold it.
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('analytics-rollup')) as ok`,
    );
    if (!lock?.ok) return { skipped: true, rebuilt: 0 };

    await tx.execute(sql`
      insert into analytics_rollup_state (id, watermark)
      values ('default', timestamptz '1970-01-01 00:00:00+00')
      on conflict (id) do nothing
    `);
    // ::text both ways: postgres-js (prepare: false) cannot bind a Date through drizzle's
    // sql template (same workaround as merchant/analytics/queries.ts).
    const [st] = await tx.execute<{ w: string; t: string }>(sql`
      select watermark::text as w, (now() - make_interval(secs => ${lag}))::text as t
      from analytics_rollup_state where id = 'default' for update
    `);
    const W = sql`${st!.w}::timestamptz`;
    const T = sql`${st!.t}::timestamptz`;

    const trailingPairs =
      trailing > 0
        ? sql`
          union
          select merchant_id, bucket_start from analytics_buckets
          where bucket_start >= ${T} - make_interval(hours => ${trailing})
          union
          select distinct j.merchant_id, ${bin(sql`j.completed_at`)}
          from jobs j
          where j.session_id is not null and j.merchant_id is not null
            and j.completed_at >= ${T} - make_interval(hours => ${trailing}) and j.completed_at < ${T}`
        : sql``;

    await tx.execute(sql`
      create temp table _analytics_affected on commit drop as
      select distinct merchant_id, ${bin(sql`occurred_at`)} as bucket_start
      from analytics_events
      where received_at >= ${W} and received_at < ${T}
      union
      select distinct j.merchant_id, ${bin(sql`j.completed_at`)}
      from jobs j
      where j.session_id is not null and j.merchant_id is not null
        and j.completed_at >= ${W} and j.completed_at < ${T}
      ${trailingPairs}
    `);

    await tx.execute(sql`
      delete from analytics_buckets b
      using _analytics_affected a
      where b.merchant_id = a.merchant_id and b.bucket_start = a.bucket_start
    `);

    // Events and derived job outcomes never share an event name, so the two halves of the
    // union cannot produce the same key. Wait time = created → completed: what the shopper
    // actually waited, queueing included. CANCELLED jobs are not outcomes and are excluded.
    await tx.execute(sql`
      insert into analytics_buckets
        (merchant_id, bucket_start, event, branch_id, device_id, staff_id, channel,
         count, value_sum, value_count)
      select e.merchant_id, a.bucket_start, e.event, e.branch_id, e.device_id, e.staff_id,
        e.channel, count(*), 0, 0
      from _analytics_affected a
      join analytics_events e
        on e.merchant_id = a.merchant_id
       and e.occurred_at >= a.bucket_start and e.occurred_at < a.bucket_start + ${BUCKET}
      group by 1, 2, 3, 4, 5, 6, 7
      union all
      select j.merchant_id, a.bucket_start,
        case when j.status = 'COMPLETED' then 'tryon_completed' else 'tryon_failed' end,
        j.branch_id, j.device_id, j.staff_id, s.mode, count(*),
        coalesce(sum(greatest(0, extract(epoch from (j.completed_at - j.created_at)) * 1000)), 0)::bigint,
        count(*)
      from _analytics_affected a
      join jobs j
        on j.merchant_id = a.merchant_id
       and j.completed_at >= a.bucket_start and j.completed_at < a.bucket_start + ${BUCKET}
      left join instore_sessions s on s.id = j.session_id
      where j.session_id is not null and j.status in ('COMPLETED', 'FAILED')
      group by 1, 2, 3, 4, 5, 6, 7
    `);

    const [n] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from _analytics_affected`,
    );
    await tx.execute(sql`
      update analytics_rollup_state set watermark = ${T}, updated_at = now() where id = 'default'
    `);
    return { skipped: false, rebuilt: Number(n?.n ?? 0) };
  });
}

/**
 * Call once after `app.listen(...)`. Ticks every minute; the first tick and then one an hour
 * also rebuild the trailing 48h (retried jobs, and a cheap guard against anything a
 * watermark-only pass could miss).
 */
export function startAnalyticsRollup(
  app: FastifyInstance,
  intervalMs: number = TICK_INTERVAL_MS,
): () => void {
  let running = false;
  let lastSafety = 0;
  const tick = () => {
    if (running) {
      app.log.warn('analytics rollup tick still running — skipping this interval');
      return;
    }
    running = true;
    const safety = Date.now() - lastSafety >= SAFETY_EVERY_MS;
    void runAnalyticsRollupTick(app, { trailingHours: safety ? SAFETY_TRAILING_HOURS : 0 })
      .then((r) => {
        if (safety && !r.skipped) lastSafety = Date.now();
      })
      .catch((err) => app.log.error({ err }, 'analytics rollup tick failed'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
