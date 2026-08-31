import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, count, gte, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { countingIdentity, type ShopperRow, shopperIdFilter } from './shopper.js';
import { formatResetTime, storeDayKey, windowEnd, windowStart } from './store-day.js';

type Store = typeof schema.shopifyStores.$inferSelect;

export interface LimitRefusal {
  reason: 'email_required' | 'shopper_limit' | 'store_limit';
  message: string;
}

/**
 * Thrown by `lockAndRecheckShopperLimits` when a concurrent request won the
 * race for this shopper's quota. Caught in the route handler and turned into
 * the normal 202 refusal — never surfaced as a 500.
 */
export class ShopperLimitRaceRefusal extends Error {
  constructor(public readonly refusal: LimitRefusal) {
    super(`shopper limit refusal under lock: ${refusal.reason}`);
    this.name = 'ShopperLimitRaceRefusal';
  }
}

/** Every shopper row in this store sharing the shopper's counting identity. */
async function siblingShopperIds(db: DB, store: Store, shopper: ShopperRow): Promise<string[]> {
  const rows = await db
    .select({ id: schema.shopifyShoppers.id })
    .from(schema.shopifyShoppers)
    .where(shopperIdFilter(store.id, countingIdentity(shopper)));
  return rows.map((row) => row.id);
}

/** Non-failed jobs by this shopper, optionally bounded to a calendar-window start. */
async function countShopperJobs(db: DB, shopperIds: string[], since: Date | null): Promise<number> {
  if (shopperIds.length === 0) return 0;

  const clauses = [
    inArray(schema.jobs.shopifyShopperId, shopperIds),
    ne(schema.jobs.status, 'FAILED'),
  ];
  if (since) clauses.push(gte(schema.jobs.createdAt, since));
  const [row] = await db
    .select({ n: count() })
    .from(schema.jobs)
    .where(and(...clauses));
  return row.n;
}

/**
 * Check the actionable email gate before the merchant's per-shopper ceiling.
 *
 * `db` accepts either the pooled connection or an in-flight transaction (cast
 * `tx as never` at the call site, matching the rest of this module's
 * transaction-passing convention — see `atomicDeduct` usage in
 * customer.routes.ts) so the same logic serves both the pre-transaction fast
 * path and the locked recheck in `lockAndRecheckShopperLimits`.
 */
export async function checkShopperLimits(
  db: DB,
  store: Store,
  shopper: ShopperRow,
): Promise<LimitRefusal | null> {
  const limits = store.settings.limits;
  if (!limits) return null;

  const shopperIds = await siblingShopperIds(db, store, shopper);
  const emailAfter = limits.emailAfterNTryOns;
  if (emailAfter != null && !shopper.email) {
    const lifetime = await countShopperJobs(db, shopperIds, null);
    if (lifetime >= emailAfter) {
      return { reason: 'email_required', message: 'Enter your email to continue.' };
    }
  }

  const cap = limits.perShopperCap;
  if (cap != null) {
    const now = new Date();
    const window = limits.perShopperWindow ?? 'week';
    const since = windowStart(store.ianaTimezone, window, now);
    const used = await countShopperJobs(db, shopperIds, since);
    if (used >= cap) {
      const resetAt = windowEnd(store.ianaTimezone, window, now);
      return {
        reason: 'shopper_limit',
        message: `You've reached your try-on limit. Come back ${formatResetTime(store.ianaTimezone, resetAt)} for more free try-ons.`,
      };
    }
  }

  return null;
}

/**
 * Serializes per-shopper limit enforcement against concurrent requests from
 * the same shopper.
 *
 * The fast-path `checkShopperLimits` call in the route runs BEFORE the
 * job-creation transaction opens, purely so an obviously-doomed request never
 * pays for a Redis slot reservation or an open transaction. It is not safe
 * on its own: two concurrent requests from the same shopper can both observe
 * capacity there and both go on to create a job, exceeding a cap of 1.
 *
 * This function must run inside that same transaction, immediately before
 * the job insert. It takes a transaction-scoped Postgres advisory lock
 * (`pg_advisory_xact_lock`, auto-released at COMMIT/ROLLBACK) keyed on
 * (store, counting identity) — the same identity `checkShopperLimits` counts
 * against — so a second concurrent request blocks until the first commits or
 * rolls back, then rechecks the limit having observed the first request's
 * outcome. `hashtextextended` folds the composite key into the single bigint
 * `pg_advisory_xact_lock` takes; a rare hash collision only ever
 * over-serializes two unrelated shoppers, it can never under-serialize one.
 */
export async function lockAndRecheckShopperLimits(
  db: DB,
  store: Store,
  shopper: ShopperRow,
): Promise<void> {
  if (!store.settings.limits) return;

  const identity = countingIdentity(shopper);
  const lockKey = `shopify-shopper:${store.id}:${identity.kind}:${identity.value}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

  const refusal = await checkShopperLimits(db, store, shopper);
  if (refusal) throw new ShopperLimitRaceRefusal(refusal);
}

// KEYS[1] = per-store-day counter key
// ARGV[1] = cap, ARGV[2] = TTL seconds (only applied on the increment that
//   creates the key)
//
// INCR, the first-use EXPIRE, and the over-cap DECR rollback were previously
// three independently-failable round trips: a crash or network blip between
// any two of them could leave an incremented-but-never-expiring counter, or
// an over-cap increment that never got rolled back. A single EVAL is one
// round trip and Redis executes the whole script without interleaving other
// commands, so there is no window in which a partial effect can be observed
// or lost.
const RESERVE_SLOT_LUA = `
local used = redis.call('INCR', KEYS[1])
if used == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if used > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return -1
end
return used
`;

// KEYS[1] = per-store-day counter key, KEYS[2] = per-job release marker
// ARGV[1] = marker TTL seconds
//
// The marker is what makes a release exactly-once *per job*, across every
// process that might compensate it: the API (admin cancel, enqueue failure)
// and the dispatcher (GPU failure, stuck-job sweep) all reach this same
// script, and a redelivered stream message or a retried request can drive any
// of them twice. Claiming the marker with SET NX in the same script as the
// DECR means only the first claimant decrements — there is no window between
// "check whether we already released" and "release".
//
// The `used > 0` guard matters because DECR on a missing key creates it at -1:
// once the day's key has expired, an unguarded release would leave a negative
// counter that hands the next store-day free slots on top of its cap.
const RELEASE_SLOT_LUA = `
if not redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[1]) then
  return 0
end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local used = tonumber(raw)
if not used or used <= 0 then return 0 end
redis.call('DECR', KEYS[1])
return 1
`;

/** Matches the counter's own 48h TTL — past that there is nothing left to give back. */
const SLOT_TTL_SEC = 48 * 60 * 60;

export interface ReservedStoreSlot {
  ok: true;
  /**
   * The counter key this reservation incremented, or null when the store is
   * uncapped. Pinned onto the job at creation so that whatever later
   * compensates it — in this process or the dispatcher — gives back the slot
   * for the day the job was *created*, with no need to recompute a
   * store-local calendar day (and no way to decrement the wrong one when a
   * job outlives the midnight it started before).
   */
  capKey: string | null;
  release: (jobId: string) => Promise<void>;
}

/** Atomically reserve one slot against the store's local-calendar daily cap. */
export async function reserveStoreDailySlot(
  app: FastifyInstance,
  store: Store,
): Promise<ReservedStoreSlot | { ok: false }> {
  const cap = store.settings.limits?.storeDailyCap;
  if (cap == null) return { ok: true, capKey: null, release: async () => {} };

  const key = `shopify:cap:store:${store.id}:${storeDayKey(store.ianaTimezone)}`;
  // 48h, not 24: covers any timezone's day plus DST slack, and the key is
  // day-scoped so a stale one is never read again.
  const used = (await app.redis.eval(RESERVE_SLOT_LUA, 1, key, cap, SLOT_TTL_SEC)) as number;

  if (used === -1) return { ok: false };

  return {
    ok: true,
    capKey: key,
    // No in-memory "already released" guard any more: the script's own marker
    // is stronger, since it also holds across processes and across a retry
    // whose first attempt actually landed but whose reply was lost.
    release: async (jobId: string) => {
      await releaseStoreDailySlot(app.redis, key, jobId);
    },
  };
}

/**
 * Give one slot back to a store's daily cap, at most once for the given job.
 *
 * Safe to call for a job that never reserved one, was already released, or
 * whose day has since expired — each of those is a no-op returning false.
 *
 * The dispatcher runs the identical script from
 * `apps/dispatcher/src/shopify/store-cap.ts`; the two must stay in step.
 */
export async function releaseStoreDailySlot(
  redis: Redis,
  capKey: string,
  jobId: string,
): Promise<boolean> {
  const released = (await redis.eval(
    RELEASE_SLOT_LUA,
    2,
    capKey,
    `shopify:cap:released:${jobId}`,
    SLOT_TTL_SEC,
  )) as number;
  return released === 1;
}
