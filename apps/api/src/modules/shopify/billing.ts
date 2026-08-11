import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getShopifyPlanCredits, getShopifyTrialCredits } from '../../lib/resolution-config.js';
import { grantStore } from '../credits/shopify-ledger.js';
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
 * shopify_credit_ledger (migration 0150), keyed on storeId + the subscription id + the
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

  // Shopify marks a subscription `test` when no money will ever change hands —
  // always the case on a development store, which any Shopify Partner can
  // create for free and without limit. Granting against one is giving product
  // away exactly like granting against a PENDING charge, only worse: once the
  // app is publicly installable, anyone can install it on their own dev store,
  // pick the top plan, take the credits, and repeat with a fresh store. Credits
  // are GPU spend, so that converts straight into cost.
  //
  // Gated rather than refused outright because a dev store is also the only way
  // to exercise the paid path end to end — blocking it unconditionally would
  // leave the billing flow untestable anywhere. Staging and local set the flag;
  // production does not, and its default is off.
  // `=== true` rather than a truthiness check: callers that build an Env object
  // directly instead of parsing it (the test harness casts one `as Env`) leave
  // this undefined, and a gate guarding revenue should read as denied for
  // anything that is not explicitly the boolean true.
  const testSubscriptionAllowed =
    !subscription.test || app.env.SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS === true;

  if (subscription.test && !testSubscriptionAllowed) {
    // Deliberately warn, not error: on a public app this is someone probing for
    // free credits, and on a real store it means Shopify sent a test charge we
    // did not expect. Either way an operator wants to see it, and neither is a
    // fault in this process.
    app.log.warn(
      { storeId: store.id, shopDomain: store.shopDomain, planName: subscription.name },
      'shopify test subscription — no credits granted (set SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS=true to allow)',
    );
  }

  // A grant is only possible when we know how much, and the subscription is
  // actually live. PENDING (merchant hasn't approved the
  // charge yet), FROZEN, DECLINED and EXPIRED all mean Shopify is not billing
  // the merchant, so granting against them would be giving product away.
  let grantable = false;
  let creditsGranted = 0;

  if (amount !== null && subscription.status === 'ACTIVE' && testSubscriptionAllowed) {
    grantable = true;
    if (isNewCycle) {
      const externalRef = `shopify_subscription:${store.id}:${subscription.id}:${
        periodEnd?.toISOString() ?? 'none'
      }`;
      // Distinct reason so test-funded credits stay separable from paid ones in
      // the ledger forever. `reason` is free text and is only ever written, so
      // this needs no migration and breaks no reader. Without it a test grant is
      // indistinguishable from a real one after the fact, and reconciling the
      // ledger against Shopify payouts becomes guesswork.
      const reason = subscription.test ? 'SHOPIFY_SUBSCRIPTION_TEST' : 'SHOPIFY_SUBSCRIPTION';
      const { granted } = await grantStore(app.db, store.id, amount, reason, externalRef);
      if (granted) creditsGranted = amount;
    }
  }

  // Only advance the stored cycle marker when a grant was actually possible.
  // If the plan name didn't map to a credit amount, or the subscription wasn't
  // ACTIVE, this cycle was never billed — leaving the marker at its previous
  // value (possibly still null) means a later sync, once the plan mapping is
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
 * store at install time, called from provisionShopifyStore. Independent of
 * Shopify's own day-based trialDays billing trial and of any paid subscription
 * — this exists so a merchant can try the feature before picking a plan.
 *
 * Idempotent via the same external_ref partial unique index (migration 0150)
 * syncStoreSubscription relies on above, keyed on store id alone so this is
 * strictly one-time per store: unlinking and relinking the same store does
 * not re-grant, but a different store linked to the same owner does.
 */
export async function grantShopifyTrialCredits(
  app: FastifyInstance,
  store: Store,
): Promise<{ creditsGranted: number }> {
  const amount = await getShopifyTrialCredits(app);
  if (amount <= 0) return { creditsGranted: 0 };

  const externalRef = `shopify_trial:${store.id}`;
  const { granted } = await grantStore(app.db, store.id, amount, 'SHOPIFY_TRIAL', externalRef);
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
