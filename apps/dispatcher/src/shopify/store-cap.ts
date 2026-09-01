import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';

/**
 * Give back one slot against a Shopify store's daily try-on cap.
 *
 * The cap is a merchant-configured ceiling on their own spend — their settings
 * page calls it "the hard ceiling… once this many try-ons have run today", and
 * their dashboard shows it as `todayTryOns / cap`. A generation that failed did
 * not run, and its credits are refunded, so it must not keep consuming the
 * merchant's day. Before this, a worker outage silently ended a store's day
 * early while charging them nothing — and left the per-shopper cap (which
 * excludes FAILED jobs) disagreeing with the store cap about the same failure.
 *
 * The counter lives in Redis and is owned by the API, which reserves a slot
 * before creating the job. The key is pinned onto `job_inputs.params` at
 * creation (`storeCapKey`) precisely so this side never has to recompute a
 * store-local calendar day: a job created at 23:59 and failed at 00:01 must
 * give its slot back to the day it was created, not the one it died in.
 *
 * This is a deliberate duplicate of `releaseStoreDailySlot` in
 * `apps/api/src/modules/shopify/limits.ts` — the two apps share no runtime
 * package, and the same pattern already exists for the `worker:health:*` and
 * `dispatcher-cg` conventions. The script must stay in step with that one.
 */

// KEYS[1] = per-store-day counter key, KEYS[2] = per-job release marker
// ARGV[1] = marker TTL seconds
//
// The marker makes this exactly-once per job across both processes: a
// redelivered stream message, a sweeper pass racing the processor, or an admin
// cancel racing a GPU failure can each drive a release twice. Claiming the
// marker with SET NX inside the same script as the DECR leaves no window
// between the check and the decrement.
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

/**
 * Release the slot recorded on a job, if it has one.
 *
 * `capKey` comes straight off `job_inputs.params.storeCapKey` and is absent for
 * an uncapped store, for a non-Shopify job, and for any job created before this
 * shipped — all of which are silent no-ops.
 *
 * Never throws. A lost slot costs the merchant one try-on off a cap that resets
 * daily; failing a refund or leaving a job non-terminal because Redis blipped
 * would cost considerably more.
 */
export async function releaseStoreCapSlot(
  redis: Redis,
  capKey: unknown,
  jobId: string,
  log: Logger,
): Promise<void> {
  if (typeof capKey !== 'string' || capKey.length === 0) return;
  try {
    const released = (await redis.eval(
      RELEASE_SLOT_LUA,
      2,
      capKey,
      `shopify:cap:released:${jobId}`,
      SLOT_TTL_SEC,
    )) as number;
    if (released === 1) {
      log.info({ jobId, capKey }, 'store daily cap slot released after failed try-on');
    }
  } catch (err) {
    log.error(
      { err, jobId, capKey },
      'store daily cap slot release failed — slot stays reserved until the 48h key expiry',
    );
  }
}
