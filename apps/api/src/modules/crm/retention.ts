import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// CRM phase 2, Task 6: profile and photo retention (spec §3). A shopper not seen for the merchant's chosen
// number of days loses everything personal: phone (encrypted and hashed), display name, and the
// link from their visits. The shoppers row and its consent history stay, anonymised, as the
// record that consent existed while the data was held; analytics rows never held personal data.
//
// Only merchants that chose a period are swept: there is no default (spec Q4). This is a
// destructive write, so it is bounded per tick and logs what it did.

const BATCH = 500;
const INTERVAL_MS = 60 * 60 * 1000;

export async function runCrmRetentionTick(app: FastifyInstance): Promise<{ wiped: number }> {
  return app.db.transaction(async (tx) => {
    const lock = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('crm-retention')) as ok`,
    );
    if (!lock[0]?.ok) return { wiped: 0 };

    const due = await tx.execute<{ id: string }>(sql`
      select s.id
      from shoppers s
      join merchant_crm_settings cs on cs.merchant_id = s.merchant_id
      where s.deleted_at is null
        and cs.profile_retention_days is not null
        and s.last_seen_at < now() - make_interval(days => cs.profile_retention_days)
      order by s.last_seen_at
      limit ${BATCH}
      for update of s skip locked
    `);
    const ids = due.map((r) => r.id);
    if (ids.length === 0) return { wiped: 0 };
    const list = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await tx.execute(
      sql`update instore_sessions set shopper_id = null where shopper_id in (${list})`,
    );
    await tx.execute(sql`
      update shoppers
      set phone_enc = null, phone_hash = null, display_name = null, deleted_at = now()
      where id in (${list})
    `);
    app.log.info({ wiped: ids.length }, 'crm retention: shopper profiles deleted');
    return { wiped: ids.length };
  });
}

const PHOTO_BATCH = 200;
const PHOTO_LOCK_KEY = 'crm:photo-retention:lock';

/**
 * Photo retention (decided 2026-11-12: ALL in-store photos, identified or not). Every job of a
 * tablet session that started more than the merchant's `photo_retention_days` ago loses its
 * customer photo and its results. Objects are deleted first and the keys nulled after: a run
 * that dies in between deletes nothing new next time (S3 deletes are idempotent) and then nulls.
 * A nulled key is also the "done" marker, so no job is visited twice.
 *
 * Merchant history keeps the job (status, credits, counts); its image is gone by design.
 * Not in a DB transaction: object deletes are network calls. A Redis lock keeps replicas apart.
 */
export async function runCrmPhotoRetentionTick(
  app: FastifyInstance,
): Promise<{ jobs: number; objects: number }> {
  const locked = await app.redis.set(PHOTO_LOCK_KEY, '1', 'EX', 600, 'NX');
  if (locked !== 'OK') return { jobs: 0, objects: 0 };
  try {
    const due = await app.db.execute<{
      id: string;
      customer_photo_key: string | null;
      result_key: string | null;
      thumbnail_key: string | null;
    }>(sql`
      select j.id, j.customer_photo_key, o.result_key, o.thumbnail_key
      from jobs j
      join instore_sessions s on s.id = j.session_id
      join merchant_crm_settings cs on cs.merchant_id = s.merchant_id
      left join job_outputs o on o.job_id = j.id
      where j.session_id is not null
        and cs.photo_retention_days is not null
        and s.started_at < now() - make_interval(days => cs.photo_retention_days)
        -- Unfinished jobs are left to finish; a later tick takes them.
        and j.status in ('COMPLETED', 'FAILED', 'CANCELLED')
        and (j.customer_photo_key is not null or o.result_key is not null or o.thumbnail_key is not null)
      limit ${PHOTO_BATCH}
    `);
    if (due.length === 0) return { jobs: 0, objects: 0 };

    const keys = new Set<string>();
    for (const r of due) {
      for (const k of [r.customer_photo_key, r.result_key, r.thumbnail_key]) if (k) keys.add(k);
    }
    for (const key of keys) await app.storage.deleteObject(key);

    const ids = sql.join(
      [...new Set(due.map((r) => r.id))].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await app.db.transaction(async (tx) => {
      await tx.execute(sql`update jobs set customer_photo_key = null where id in (${ids})`);
      await tx.execute(
        sql`update job_outputs set result_key = null, thumbnail_key = null where job_id in (${ids})`,
      );
    });
    app.log.info(
      { jobs: due.length, objects: keys.size },
      'crm retention: in-store photos deleted',
    );
    return { jobs: due.length, objects: keys.size };
  } finally {
    await app.redis.del(PHOTO_LOCK_KEY);
  }
}

/** Call once after `app.listen(...)`. Hourly; a tick that finds a full batch runs again soon. */
export function startCrmRetention(app: FastifyInstance, intervalMs = INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runCrmRetentionTick(app)
      .then(() => runCrmPhotoRetentionTick(app))
      .catch((err) => app.log.error({ err }, 'crm retention tick failed'))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
