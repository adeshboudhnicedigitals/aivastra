import { schema } from '@aivastra/db';
import { SIMPLE_TRYON_COST } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { grantStore } from '../credits/shopify-ledger.js';
import { createUsageRecord } from './autorefill-client.js';
import { getPack } from './packs.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/** Fraction of the chosen pack at which a refill fires, when the merchant hasn't set their own. */
const DEFAULT_TRIGGER_FRACTION = 0.2;

/** 20% of the chosen pack's manual credits, or null for a pack we don't sell. */
export function defaultTriggerCredits(packId: string): number | null {
  const pack = getPack(packId);
  if (!pack) return null;
  return Math.round(pack.credits * DEFAULT_TRIGGER_FRACTION);
}

/**
 * Whether this store is due a refill right now.
 *
 * Pure so the eligibility rules are testable without a database. The ACTIVE
 * check is the load-bearing one: `autorefillStatus` is PENDING between creating
 * the subscription and the merchant approving it, and charging against an
 * unapproved authorization would be giving product away against a charge that
 * may never be accepted.
 */
export function shouldRefill(input: {
  balance: number;
  triggerCredits: number | null;
  status: string | null;
}): boolean {
  if (input.triggerCredits == null) return false;
  if (input.status !== 'ACTIVE') return false;
  return input.balance <= input.triggerCredits;
}

interface RefillDeps {
  charge?: typeof createUsageRecord;
}

/**
 * Charges and grants exactly one refill, or explains why it didn't.
 *
 * ## The three guards, and why each is needed
 *
 * A merchant being charged twice for one refill is the worst thing this feature
 * can do, and the three ways it could happen are genuinely different problems:
 *
 * 1. **A SESSION-scoped `pg_advisory_lock`** (`withAdvisoryLock`, see
 *    `packages/db/src/index.ts`), held for the *entire* function body — the
 *    insert, the Shopify `charge()` call, and the merged ACTIVE+grant
 *    transaction — not just the initial insert. Two earlier shapes of this
 *    guard were tried and both measurably failed under a real concurrent
 *    race (`Promise.all([runRefill(...), runRefill(...)])` against the same
 *    store, reproduced deterministically, hrtime-traced):
 *      - A transaction-scoped `pg_advisory_xact_lock`, held only for the
 *        insert. It releases at that transaction's own COMMIT — well before
 *        `charge()` runs — so a second caller can acquire the freed lock and
 *        run its own insert while the first caller is still mid-flight
 *        outside any lock.
 *      - The same, plus merging the ACTIVE-transition and the grant into one
 *        transaction (to remove the "ACTIVE but balance still stale" window).
 *        That closes one narrower gap but not the real one: the lock is
 *        *still* released after the insert alone. A second caller's own
 *        `SELECT` can legitimately read the pre-grant balance while the first
 *        caller's merge-transaction is open (correct, per Postgres READ
 *        COMMITTED), and then that second caller's later `INSERT` — a
 *        separate statement, its own fresh snapshot — lands *after* the first
 *        caller's merge-transaction has already committed and flipped the row
 *        off `PENDING`. Guard 2's partial index has nothing left to conflict
 *        with, the second insert succeeds, and both callers charge.
 *    A session lock doesn't release at any transaction boundary — only when
 *    `withAdvisoryLock`'s `finally` runs, after the whole callback (including
 *    `charge()`) resolves — so no second caller can even start its own
 *    attempt until the first one, in full, is done. It still uses separate,
 *    independently-committing transactions inside the callback (via the
 *    reserved connection's own `db`), so the initial `PENDING` row is durable
 *    *before* `charge()` is ever called — a mid-call crash still leaves a
 *    real audit-trail row for Guard 3 to key a retry off, exactly as before.
 * 2. **The partial unique index on one in-flight `autorefill` purchase per
 *    store** (migration 0159). A database-level backstop that still holds if a
 *    later refactor moves or drops the lock — the failure mode being guarded
 *    against is too expensive to depend on one mechanism a refactor can quietly
 *    remove.
 * 3. **Shopify's own `idempotencyKey`, keyed on our purchase row id.** The only
 *    guard that helps when we time out on a request Shopify actually accepted.
 *    No application-side locking can detect that case, because from our side a
 *    successful charge and a lost response look identical. Retrying the same
 *    row reuses the key and cannot double-charge.
 *
 * Guard 1 stops two attempts running at all. Guard 2 stops two rows existing
 * even if 1 is somehow bypassed. Guard 3 stops two *charges* for one row.
 * Removing any of them leaves a real hole.
 */
export async function runRefill(
  app: FastifyInstance,
  store: Store,
  deps: RefillDeps = {},
): Promise<'refilled' | 'skipped' | 'cap_reached' | 'failed'> {
  const charge = deps.charge ?? createUsageRecord;

  const packId = store.autorefillPackId;
  const lineItemId = store.autorefillLineItemId;
  if (!packId || !lineItemId) return 'skipped';

  const pack = getPack(packId);
  if (!pack) {
    app.log.error(
      { storeId: store.id, packId },
      'auto-refill configured with a pack we no longer sell — refill skipped',
    );
    return 'skipped';
  }

  return app.withAdvisoryLock(`shopify-autorefill:${store.id}`, async (lockedDb) => {
    // Guard 1 is this lock itself, held for everything below. The old
    // per-transaction pg_advisory_xact_lock is gone — nothing else needs it,
    // since only one caller can be inside this callback for this store's key
    // at a time.
    const purchaseId = await lockedDb.transaction(async (tx) => {
      const [credits] = await tx
        .select({ balance: schema.shopifyStoreCredits.balance })
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));

      const eligible = shouldRefill({
        balance: credits?.balance ?? 0,
        triggerCredits: store.autorefillTriggerCredits,
        status: store.autorefillStatus,
      });
      if (!eligible) {
        return null;
      }

      // Guard 2: the partial unique index rejects a second in-flight
      // autorefill row for this store — a backstop, per the reasoning above,
      // not the thing actually doing the work now.
      const inserted = await tx
        .insert(schema.shopifyCreditPurchases)
        .values({
          storeId: store.id,
          source: 'autorefill',
          packId: pack.id,
          // Snapshotted at INSERT exactly like a manual purchase — the grant
          // reads this column, never CREDIT_PACKS, so an admin editing pack
          // generosity mid-flight cannot change what this refill delivers.
          credits: pack.autorefillCredits,
          priceUsdCents: Math.round(pack.priceUsd * 100),
          status: 'PENDING',
        })
        .onConflictDoNothing()
        .returning({ id: schema.shopifyCreditPurchases.id });

      return inserted[0]?.id ?? null;
    });

    if (!purchaseId) return 'skipped';

    const tryOns = Math.floor(pack.autorefillCredits / SIMPLE_TRYON_COST);

    // Guard 3: Shopify's idempotency key, keyed on the row. A retry after a
    // timeout reuses it and cannot produce a second charge.
    const result = await charge(app, store, {
      lineItemId,
      description: `AiVastra auto-refill — ${tryOns} try-ons`,
      amountUsd: pack.priceUsd,
      idempotencyKey: `autorefill:${purchaseId}`,
    });

    if (!result.ok) {
      await lockedDb
        .update(schema.shopifyCreditPurchases)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.shopifyCreditPurchases.id, purchaseId));

      if (result.capReached) {
        await lockedDb
          .update(schema.shopifyStores)
          .set({ autorefillStatus: 'CAP_REACHED', updatedAt: new Date() })
          .where(eq(schema.shopifyStores.id, store.id));
        // warn, not error: the merchant set this ceiling and it is doing its job.
        app.log.warn(
          { storeId: store.id, shopDomain: store.shopDomain },
          'auto-refill stopped — monthly spend ceiling reached',
        );
        return 'cap_reached';
      }

      app.log.error(
        { storeId: store.id, message: result.message },
        'auto-refill charge failed — will retry on the next trigger',
      );
      return 'failed';
    }

    // The ACTIVE transition and the grant stay merged into one transaction —
    // it's still correct for a single reader to never observe "ACTIVE, stale
    // balance" — but the thing actually preventing a second refill here is
    // the session lock held around this whole callback, not this merge.
    const { granted } = await lockedDb.transaction(async (tx) => {
      await tx
        .update(schema.shopifyCreditPurchases)
        .set({ shopifyChargeId: result.recordId, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(schema.shopifyCreditPurchases.id, purchaseId));

      return grantStore(
        tx as never,
        store.id,
        pack.autorefillCredits,
        'SHOPIFY_AUTOREFILL',
        `shopify_autorefill:${result.recordId}`,
      );
    });

    app.log.info(
      { storeId: store.id, purchaseId, credits: pack.autorefillCredits, granted },
      'auto-refill completed',
    );
    return 'refilled';
  });
}
