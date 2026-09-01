import { schema } from '@aivastra/db';
import { SIMPLE_TRYON_COST } from '@aivastra/types';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { grantStore } from '../credits/shopify-ledger.js';
import { createUsageRecord } from './autorefill-client.js';

type Store = typeof schema.shopifyStores.$inferSelect;
type PurchaseRow = typeof schema.shopifyCreditPurchases.$inferSelect;

export interface ReconcileDeps {
  charge?: typeof createUsageRecord;
}

/**
 * Only rows older than this are touched. `runRefill` holds its advisory lock
 * across the whole charge, so a live attempt already excludes us — this is the
 * second line of defence, and it also keeps the sweep away from a row whose
 * charge is merely slow rather than abandoned.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

/** One sweep touches at most this many rows, so a large backlog can't monopolise a tick. */
const BATCH = 50;

export type ReconcileOutcome =
  | 'resolved_active'
  | 'resolved_failed'
  | 'cap_reached'
  | 'unverifiable'
  | 'skipped'
  | 'retry_later';

/**
 * Resolve one stranded autorefill purchase row.
 *
 * The row is stuck because `createUsageRecord` THREW rather than returning a
 * result (see the Guard 3 comment in autorefill.ts): we never learned whether
 * Shopify created the charge. `shopify_credit_purchases_one_pending_autorefill`
 * — UNIQUE (store_id) WHERE status='PENDING' AND source='autorefill' — then
 * rejects every later refill insert for that store, so auto-refill stops
 * permanently and the balance drains to zero with nothing but a log line.
 *
 * The resolution is to REPLAY the charge under the row's original idempotency
 * key rather than to query for it. Shopify treats a repeat of the same key as
 * the same charge and returns the original record, so the replay is safe
 * whether or not the first attempt landed — and it settles the row either way.
 * That is also why we must not simply mark the row FAILED: a new refill would
 * mint a new row with a NEW key, which is exactly the double charge the
 * idempotency key exists to prevent.
 */
export async function reconcileStalePurchase(
  app: FastifyInstance,
  store: Store,
  row: PurchaseRow,
  deps: ReconcileDeps = {},
): Promise<ReconcileOutcome> {
  const charge = deps.charge ?? createUsageRecord;
  const lineItemId = store.autorefillLineItemId;

  // No line item means the subscription is gone — the store uninstalled (which
  // clears these columns) or the merchant cancelled. We cannot replay the
  // charge, so we cannot learn whether the merchant was billed. Marking the
  // row FAILED here would unblock future refills but silently write off a
  // charge that may have been paid and never granted, so this stays PENDING
  // and loud: a human has to look at it. Logged every sweep on purpose — this
  // is the alert.
  if (!lineItemId) {
    app.log.error(
      { storeId: store.id, shopDomain: store.shopDomain, purchaseId: row.id },
      'stranded auto-refill purchase cannot be reconciled — store has no autorefill line item (uninstalled or cancelled); charge state unverifiable, manual follow-up required',
    );
    return 'unverifiable';
  }

  const outcome = await app.withAdvisoryLock(`shopify-autorefill:${store.id}`, async (lockedDb) => {
    // Re-read under the lock. A concurrent runRefill (or an earlier tick) may
    // have settled this row between the sweep's SELECT and here, and replaying
    // a charge for an already-ACTIVE row would be a second, unwanted refill.
    const [fresh] = await lockedDb
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, row.id))
      .limit(1);
    if (fresh?.status !== 'PENDING') return 'skipped' as const;

    const tryOns = Math.floor(fresh.credits / SIMPLE_TRYON_COST);
    let result: Awaited<ReturnType<typeof charge>>;
    try {
      result = await charge(app, store, {
        lineItemId,
        description: `AiVastra auto-refill — ${tryOns} try-ons`,
        // Both from the row, never from the live pack: the charge being
        // replayed is the one this row recorded, and an admin editing pack
        // pricing since then must not change what the merchant is billed.
        amountUsd: fresh.priceUsdCents / 100,
        idempotencyKey: `autorefill:${fresh.id}`,
      });
    } catch (err) {
      // Still unreachable, or still throttled. Leave it PENDING and try again
      // next tick — the row is already blocking refills, so a failed retry
      // costs nothing beyond the delay it was already suffering.
      app.log.warn(
        { err, storeId: store.id, purchaseId: fresh.id },
        'auto-refill reconciliation replay threw — leaving row PENDING for the next sweep',
      );
      return 'retry_later' as const;
    }

    if (!result.ok) {
      if (result.capReached) {
        await lockedDb.transaction(async (tx) => {
          await tx
            .update(schema.shopifyCreditPurchases)
            .set({ status: 'FAILED', updatedAt: new Date() })
            .where(eq(schema.shopifyCreditPurchases.id, fresh.id));
          await tx
            .update(schema.shopifyStores)
            .set({ autorefillStatus: 'CAP_REACHED', updatedAt: new Date() })
            .where(eq(schema.shopifyStores.id, store.id));
        });
        app.log.warn(
          { storeId: store.id, purchaseId: fresh.id },
          'stranded auto-refill purchase resolved — monthly spend ceiling reached',
        );
        return 'cap_reached' as const;
      }

      // Shopify rejected the charge outright. No record exists under this key,
      // so releasing the row is safe — a later refill mints a new key for a
      // charge Shopify never accepted.
      await lockedDb
        .update(schema.shopifyCreditPurchases)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.shopifyCreditPurchases.id, fresh.id));
      app.log.error(
        { storeId: store.id, purchaseId: fresh.id, message: result.message },
        'stranded auto-refill purchase resolved as FAILED — Shopify rejected the replayed charge',
      );
      return 'resolved_failed' as const;
    }

    // Either the original charge landed and Shopify just handed it back, or
    // this replay created it. Both mean the merchant is billed and owed the
    // credits. grantStore is idempotent on external_ref, keyed on the record
    // id, so the grant is safe even if a previous partial run got this far.
    const { granted } = await lockedDb.transaction(async (tx) => {
      await tx
        .update(schema.shopifyCreditPurchases)
        .set({ shopifyChargeId: result.recordId, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(schema.shopifyCreditPurchases.id, fresh.id));
      return grantStore(
        tx as never,
        store.id,
        fresh.credits,
        store.partnerDevelopment ? 'SHOPIFY_AUTOREFILL_TEST' : 'SHOPIFY_AUTOREFILL',
        `shopify_autorefill:${result.recordId}`,
      );
    });

    app.log.info(
      { storeId: store.id, purchaseId: fresh.id, credits: fresh.credits, granted },
      'stranded auto-refill purchase reconciled — credits granted',
    );
    return 'resolved_active' as const;
  });

  // withAdvisoryLock resolves undefined when the lock was not acquired — a
  // live runRefill owns this store right now, so there is nothing stranded to
  // fix. Same treatment runRefill gives the symmetric case.
  return outcome ?? 'skipped';
}

/** One sweep over every store holding a stale PENDING autorefill row. */
export async function runReconcileTick(
  app: FastifyInstance,
  deps: ReconcileDeps = {},
): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const rows = await app.db
    .select({ purchase: schema.shopifyCreditPurchases, store: schema.shopifyStores })
    .from(schema.shopifyCreditPurchases)
    .innerJoin(
      schema.shopifyStores,
      eq(schema.shopifyStores.id, schema.shopifyCreditPurchases.storeId),
    )
    .where(
      and(
        eq(schema.shopifyCreditPurchases.status, 'PENDING'),
        eq(schema.shopifyCreditPurchases.source, 'autorefill'),
        lt(schema.shopifyCreditPurchases.updatedAt, cutoff),
      ),
    )
    .orderBy(sql`${schema.shopifyCreditPurchases.updatedAt} asc`)
    .limit(BATCH);

  if (rows.length === 0) return;
  app.log.info({ stranded: rows.length }, 'reconciling stranded auto-refill purchases');

  for (const { purchase, store } of rows) {
    try {
      await reconcileStalePurchase(app, store, purchase, deps);
    } catch (err) {
      // One store's failure must not abandon the rest of the batch.
      app.log.error(
        { err, storeId: store.id, purchaseId: purchase.id },
        'auto-refill reconciliation failed for store',
      );
    }
  }
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Runs more often than the hourly alert scheduler: every tick a stranded row
 * survives is a tick during which that store cannot auto-refill at all, and
 * the work is a no-op query whenever nothing is stuck.
 *
 * Call once after `app.listen(...)`.
 */
export function startAutorefillReconciler(
  app: FastifyInstance,
  intervalMs: number = FIFTEEN_MINUTES_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('auto-refill reconciliation tick still running — skipping this interval');
      return;
    }
    running = true;
    void runReconcileTick(app)
      .catch((err) => {
        app.log.error({ err }, 'auto-refill reconciliation tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
