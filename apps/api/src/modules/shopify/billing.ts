import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getShopifyPlanCredits, getShopifyTrialCredits } from '../../lib/resolution-config.js';
import { normalizePlanName } from './billing-plans.js';
import {
  type ActiveSubscription,
  getActiveSubscription as defaultGetActiveSubscription,
} from './subscription-client.js';

type Store = typeof schema.shopifyStores.$inferSelect;

export interface SyncResult {
  planHandle: string | null;
  subscriptionStatus: string | null;
  creditsGranted: number;
}

interface SyncDeps {
  getActiveSubscription?: (
    app: FastifyInstance,
    store: Store,
  ) => Promise<ActiveSubscription | null>;
}

/**
 * Re-checks one store's Shopify App Pricing subscription against the Admin
 * GraphQL API (the only source of truth — Shopify App Pricing sends no
 * webhooks) and grants credits for a new billing cycle exactly once.
 *
 * The read goes through the store's own offline Admin token, because
 * `currentAppInstallation.activeSubscriptions` is scoped to whichever shop
 * authenticates the request. There is no org-level equivalent.
 *
 * Idempotency is enforced by the (external_ref) partial unique index on
 * credit_ledger (migration 0148), keyed on storeId + the subscription id + the
 * period end. That, not application-level locking, is what makes this safe to
 * call concurrently from both the redirect-confirm route and the scheduler poll
 * for the same store — matches the existing atomicDeduct/refund idiom in
 * credits/ledger.ts rather than introducing SELECT ... FOR UPDATE, which this
 * codebase doesn't otherwise use.
 */
export async function syncStoreSubscription(
  app: FastifyInstance,
  store: Store,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const getSubscription = deps.getActiveSubscription ?? defaultGetActiveSubscription;
  const subscription = await getSubscription(app, store);

  if (!subscription) {
    await app.db
      .update(schema.shopifyStores)
      .set({
        subscriptionStatus: 'cancelled',
        lastBillingSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopifyStores.id, store.id));
    return { planHandle: null, subscriptionStatus: 'cancelled', creditsGranted: 0 };
  }

  // The Admin API has no plan handle — `name` is the display name configured in
  // Partner Dashboard. Normalized so the persisted value (and the frontend's
  // PLAN_LABELS lookup) is stable regardless of how it was capitalized there.
  const planHandle = normalizePlanName(subscription.name) || null;
  const subscriptionStatus = subscription.status.toLowerCase();
  const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;

  // Keyed off BOTH the subscription id and its period end, because Shopify's
  // behavior on a plan change is not something we can verify without a live
  // test store: an upgrade may mutate the same AppSubscription in place, or it
  // may cancel the old one and issue a new id. Treating either value changing
  // as a new cycle covers both — a same-id renewal (period end advances) and a
  // mid-cycle plan swap (id changes, period end may not).
  const isNewCycle =
    store.currentSubscriptionId !== subscription.id ||
    (store.currentPeriodEnd?.getTime() ?? null) !== (periodEnd?.getTime() ?? null);

  const amount = planHandle ? await getShopifyPlanCredits(app, planHandle) : null;

  if (amount === null) {
    // Operator-visible rather than silent: a plan renamed in Partner Dashboard
    // without the matching change to billing-plans.ts stops all credit grants
    // for every merchant on that plan, and nothing else would surface it.
    app.log.error(
      { storeId: store.id, planName: subscription.name },
      'unrecognized Shopify plan name — no credits granted',
    );
  }

  // A grant is only possible when we know who to credit, how much, and the
  // subscription is actually live. PENDING (merchant hasn't approved the
  // charge yet), FROZEN, DECLINED and EXPIRED all mean Shopify is not billing
  // the merchant, so granting against them would be giving product away.
  const ownerUserId = store.ownerUserId;
  let grantable = false;
  let creditsGranted = 0;

  if (ownerUserId !== null && amount !== null && subscription.status === 'ACTIVE') {
    grantable = true;
    if (isNewCycle) {
      const externalRef = `shopify_subscription:${store.id}:${subscription.id}:${
        periodEnd?.toISOString() ?? 'none'
      }`;
      const granted = await app.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.creditLedger)
          .values({
            userId: ownerUserId,
            delta: amount,
            reason: 'SHOPIFY_SUBSCRIPTION',
            externalRef,
          })
          .onConflictDoNothing()
          .returning({ id: schema.creditLedger.id });
        if (!inserted.length) return false; // already granted for this cycle
        await tx
          .insert(schema.userCredits)
          .values({ userId: ownerUserId, balance: amount })
          .onConflictDoUpdate({
            target: schema.userCredits.userId,
            set: { balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() },
          });
        return true;
      });
      if (granted) creditsGranted = amount;
    }
  }

  // Only advance the stored cycle marker when a grant was actually possible.
  // If there was no owner to credit, or the plan name didn't map to a credit
  // amount, or the subscription wasn't ACTIVE, this cycle was never billed to
  // anyone — leaving the marker at its previous value (possibly still null)
  // means a later sync, once the store gets an owner / the plan mapping is
  // fixed / the subscription goes live, still sees isNewCycle === true for the
  // same cycle and grants it. Advancing unconditionally would silently mark an
  // unbilled cycle as "seen" and the merchant would never get those credits.
  const marker = grantable
    ? { currentSubscriptionId: subscription.id, currentPeriodEnd: periodEnd }
    : {
        currentSubscriptionId: store.currentSubscriptionId,
        currentPeriodEnd: store.currentPeriodEnd,
      };

  await app.db
    .update(schema.shopifyStores)
    .set({
      planHandle,
      subscriptionStatus,
      ...marker,
      lastBillingSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, store.id));

  return { planHandle, subscriptionStatus, creditsGranted };
}

/**
 * Grants a one-time, admin-configured number of free trial credits to a
 * store's owner the moment the store first gets linked to an AiVastra
 * account (POST /v1/shopify/store/account/link). Independent of Shopify's
 * own day-based trialDays billing trial and of any paid subscription — this
 * exists so a merchant can try the feature before picking a plan.
 *
 * Idempotent via the same external_ref partial unique index (migration 0148)
 * syncStoreSubscription relies on above, keyed on store id alone so this is
 * strictly one-time per store: unlinking and relinking the same store does
 * not re-grant, but a different store linked to the same owner does.
 */
export async function grantShopifyTrialCredits(
  app: FastifyInstance,
  store: Store,
  userId: string,
): Promise<{ creditsGranted: number }> {
  const amount = await getShopifyTrialCredits(app);
  if (amount <= 0) return { creditsGranted: 0 };

  const externalRef = `shopify_trial:${store.id}`;
  const granted = await app.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.creditLedger)
      .values({ userId, delta: amount, reason: 'SHOPIFY_TRIAL', externalRef })
      .onConflictDoNothing()
      .returning({ id: schema.creditLedger.id });
    if (!inserted.length) return false;
    await tx
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({
        target: schema.userCredits.userId,
        set: { balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() },
      });
    return true;
  });

  return { creditsGranted: granted ? amount : 0 };
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
