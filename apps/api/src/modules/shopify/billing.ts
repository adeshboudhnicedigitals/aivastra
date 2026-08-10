import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { creditsForPlanHandle } from './billing-plans.js';
import {
  type ActiveSubscription,
  getActiveSubscription as defaultGetActiveSubscription,
} from './partner-client.js';

interface PartnerEnv {
  SHOPIFY_PARTNER_API_TOKEN?: string;
  SHOPIFY_PARTNER_ORG_ID?: string;
  SHOPIFY_PARTNER_APP_GID?: string;
}

export interface SyncResult {
  planHandle: string | null;
  subscriptionStatus: string | null;
  creditsGranted: number;
}

interface SyncDeps {
  getActiveSubscription?: (
    env: PartnerEnv,
    shopifyShopId: number,
    fetchImpl?: typeof fetch,
  ) => Promise<ActiveSubscription | null>;
}

/**
 * Re-checks one store's Shopify App Pricing subscription against the Partner
 * API (the only source of truth — Shopify App Pricing sends no webhooks) and
 * grants credits for a new billing cycle exactly once.
 *
 * Idempotency is enforced by the (external_ref) partial unique index on
 * credit_ledger (migration 0148), keyed on storeId + the cycle's start time.
 * That, not application-level locking, is what makes this safe to call
 * concurrently from both the redirect-confirm route and the scheduler poll
 * for the same store — matches the existing atomicDeduct/refund idiom in
 * credits/ledger.ts rather than introducing SELECT ... FOR UPDATE, which this
 * codebase doesn't otherwise use.
 */
export async function syncStoreSubscription(
  db: DB,
  env: PartnerEnv,
  store: typeof schema.shopifyStores.$inferSelect,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const getSubscription = deps.getActiveSubscription ?? defaultGetActiveSubscription;
  const subscription = await getSubscription(env, store.shopifyShopId);

  if (!subscription) {
    await db
      .update(schema.shopifyStores)
      .set({
        subscriptionStatus: 'cancelled',
        lastBillingSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopifyStores.id, store.id));
    return { planHandle: null, subscriptionStatus: 'cancelled', creditsGranted: 0 };
  }

  const planHandle = subscription.items[0]?.handle ?? null;
  const cycleStart = subscription.currentBillingCycle
    ? new Date(subscription.currentBillingCycle.startTime)
    : null;
  const isNewCycle =
    !!cycleStart &&
    (!store.currentBillingCycleStart ||
      cycleStart.getTime() !== store.currentBillingCycleStart.getTime());

  let creditsGranted = 0;

  if (store.ownerUserId && planHandle && isNewCycle) {
    const amount = creditsForPlanHandle(planHandle);
    if (amount) {
      const externalRef = `shopify_subscription:${store.id}:${cycleStart!.toISOString()}`;
      const granted = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.creditLedger)
          .values({
            userId: store.ownerUserId!,
            delta: amount,
            reason: 'SHOPIFY_SUBSCRIPTION',
            externalRef,
          })
          .onConflictDoNothing()
          .returning({ id: schema.creditLedger.id });
        if (!inserted.length) return false; // already granted for this cycle
        await tx
          .insert(schema.userCredits)
          .values({ userId: store.ownerUserId!, balance: amount })
          .onConflictDoUpdate({
            target: schema.userCredits.userId,
            set: { balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() },
          });
        return true;
      });
      if (granted) creditsGranted = amount;
    }
  }

  // Only advance the stored cycle marker when there was actually an owner to
  // grant to. If ownerUserId is null, this cycle was never billed — leaving
  // currentBillingCycleStart at its previous value (possibly still null)
  // means a later sync, once the store gets linked to an owner, still sees
  // isNewCycle === true for this same cycle and grants it. Advancing it
  // unconditionally here would silently mark an unbilled cycle as "seen" and
  // the merchant would never receive credits for it.
  const cycleStartToPersist = store.ownerUserId ? cycleStart : store.currentBillingCycleStart;

  await db
    .update(schema.shopifyStores)
    .set({
      planHandle,
      subscriptionStatus: 'active',
      currentBillingCycleStart: cycleStartToPersist,
      lastBillingSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, store.id));

  return { planHandle, subscriptionStatus: 'active', creditsGranted };
}

/**
 * The Shopify-hosted plan picker. Must be opened as a top-level navigation
 * (it's outside the embedded app's own origin) — see navigateTopLevel in
 * apps/shopify/src/lib/api.ts for the client-side helper that does that.
 */
export function buildPlanSelectionUrl(shopDomain: string, appHandle: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
