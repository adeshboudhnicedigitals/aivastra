import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// CRM phase 2, Task 6: profile retention (spec §3). A shopper not seen for the merchant's chosen
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

/** Call once after `app.listen(...)`. Hourly; a tick that finds a full batch runs again soon. */
export function startCrmRetention(app: FastifyInstance, intervalMs = INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runCrmRetentionTick(app)
      .catch((err) => app.log.error({ err }, 'crm retention tick failed'))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
