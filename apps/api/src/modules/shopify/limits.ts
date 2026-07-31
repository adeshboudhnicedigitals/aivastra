import { schema } from '@aivastra/db';
import { and, count, gte, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { countingIdentity, type ShopperRow, shopperIdFilter } from './shopper.js';
import { storeDayKey, windowStart } from './store-day.js';

type Store = typeof schema.shopifyStores.$inferSelect;

export interface LimitRefusal {
  reason: 'email_required' | 'shopper_limit' | 'store_limit';
  message: string;
}

/** Every shopper row in this store sharing the shopper's counting identity. */
async function siblingShopperIds(
  app: FastifyInstance,
  store: Store,
  shopper: ShopperRow,
): Promise<string[]> {
  const rows = await app.db
    .select({ id: schema.shopifyShoppers.id })
    .from(schema.shopifyShoppers)
    .where(shopperIdFilter(store.id, countingIdentity(shopper)));
  return rows.map((row) => row.id);
}

/** Non-failed jobs by this shopper, optionally bounded to a calendar-window start. */
async function countShopperJobs(
  app: FastifyInstance,
  shopperIds: string[],
  since: Date | null,
): Promise<number> {
  if (shopperIds.length === 0) return 0;

  const clauses = [
    inArray(schema.jobs.shopifyShopperId, shopperIds),
    ne(schema.jobs.status, 'FAILED'),
  ];
  if (since) clauses.push(gte(schema.jobs.createdAt, since));
  const [row] = await app.db
    .select({ n: count() })
    .from(schema.jobs)
    .where(and(...clauses));
  return row.n;
}

/** Check the actionable email gate before the merchant's per-shopper ceiling. */
export async function checkShopperLimits(
  app: FastifyInstance,
  store: Store,
  shopper: ShopperRow,
): Promise<LimitRefusal | null> {
  const limits = store.settings.limits;
  if (!limits) return null;

  const shopperIds = await siblingShopperIds(app, store, shopper);
  const emailAfter = limits.emailAfterNTryOns;
  if (emailAfter != null && !shopper.email) {
    const lifetime = await countShopperJobs(app, shopperIds, null);
    if (lifetime >= emailAfter) {
      return { reason: 'email_required', message: 'Enter your email to continue.' };
    }
  }

  const cap = limits.perShopperCap;
  if (cap != null) {
    const since = windowStart(store.ianaTimezone, limits.perShopperWindow ?? 'week');
    const used = await countShopperJobs(app, shopperIds, since);
    if (used >= cap) {
      return {
        reason: 'shopper_limit',
        message: "You've reached your try-on limit. Check back later.",
      };
    }
  }

  return null;
}

/** Atomically reserve one slot against the store's local-calendar daily cap. */
export async function reserveStoreDailySlot(
  app: FastifyInstance,
  store: Store,
): Promise<{ ok: true; release: () => Promise<void> } | { ok: false }> {
  const cap = store.settings.limits?.storeDailyCap;
  if (cap == null) return { ok: true, release: async () => {} };

  const key = `shopify:cap:store:${store.id}:${storeDayKey(store.ianaTimezone)}`;
  const used = await app.redis.incr(key);
  if (used === 1) {
    try {
      await app.redis.expire(key, 48 * 60 * 60);
    } catch (err) {
      await app.redis.decr(key);
      throw err;
    }
  }

  if (used > cap) {
    await app.redis.decr(key);
    return { ok: false };
  }

  let released = false;
  let releaseInFlight: Promise<void> | null = null;
  return {
    ok: true,
    release: async () => {
      if (released) return;
      if (!releaseInFlight) {
        releaseInFlight = app.redis
          .decr(key)
          .then(() => {
            released = true;
          })
          .catch((err) => {
            releaseInFlight = null;
            throw err;
          });
      }
      await releaseInFlight;
    },
  };
}
