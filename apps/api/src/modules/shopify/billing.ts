import { schema } from '@aivastra/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getShopifyPlanCredits, getShopifyTrialCredits } from '../../lib/resolution-config.js';
import { grantStore } from '../credits/shopify-ledger.js';
import { normalizePlanName } from './billing-plans.js';
import { DEFAULT_PAYG_SPEND_CAP_USD_CENTS } from './payg.js';
import {
  type ActiveSubscription,
  getActiveSubscription as defaultGetActiveSubscription,
} from './subscription-client.js';

type Store = typeof schema.shopifyStores.$inferSelect;

const PAYG_PLAN_NAME = 'pay as you go'; // normalizePlanName'd match against Partner Dashboard's plan display name

export interface SyncResult {
  planHandle: string | null;
  subscriptionStatus: string | null;
  creditsGranted: number;
  billingMode: 'prepaid' | 'usage';
}

/**
 * Sum of this-cycle shopify_usage_events for one store, in USD cents,
 * restricted to rows already REPORTED to Shopify's App Events API — used
 * only by the reconciliation check below, which compares against what
 * Shopify says it has billed. This intentionally differs from
 * payg.ts's getPaygSpendThisCycleCents (which also counts PENDING rows
 * for cap enforcement): a row Shopify hasn't been told about yet cannot
 * possibly be reflected in its balance, so including it here would make
 * every cycle look like a false-positive mismatch.
 */
async function getPaygSpendThisCycleCentsForReconciliation(
  app: FastifyInstance,
  storeId: string,
  periodEnd: Date | null,
): Promise<number> {
  const windowStart = periodEnd
    ? new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await app.db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.shopifyUsageEvents.priceUsdCents}), 0)::int`,
    })
    .from(schema.shopifyUsageEvents)
    .where(
      and(
        eq(schema.shopifyUsageEvents.storeId, storeId),
        eq(schema.shopifyUsageEvents.status, 'REPORTED'),
        gte(schema.shopifyUsageEvents.createdAt, windowStart),
      ),
    );
  return row?.total ?? 0;
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
        billingMode: 'prepaid', // a store with no subscription can't be billed by usage
        lastBillingSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopifyStores.id, store.id));
    return {
      planHandle: null,
      subscriptionStatus: 'cancelled',
      creditsGranted: 0,
      billingMode: 'prepaid',
    };
  }

  // The Admin API has no plan handle — `name` is the display name configured in
  // Partner Dashboard. Normalized so the persisted value (and the frontend's
  // PLAN_LABELS lookup) is stable regardless of how it was capitalized there.
  const planHandle = normalizePlanName(subscription.name) || null;
  const billingMode: 'prepaid' | 'usage' = planHandle === PAYG_PLAN_NAME ? 'usage' : 'prepaid';
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

  if (amount === null && billingMode !== 'usage') {
    // Operator-visible rather than silent: a plan renamed in Partner Dashboard
    // without the matching change to billing-plans.ts stops all credit grants
    // for every merchant on that plan, and nothing else would surface it.
    // Excludes 'usage' (PAYG) stores: amount === null is the expected,
    // intentional path there (PAYG is deliberately absent from
    // SHOPIFY_PLAN_HANDLES — it gets zero prepaid credits by design, not by
    // misconfiguration), so logging it as "unrecognized" here would fire on
    // every sync for every PAYG store forever and bury genuine mismatches
    // under per-store, per-hour noise.
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

  // Seed a default spend cap the first time a store becomes 'usage' — never
  // overwrite an existing value, which could be a merchant's own edit made
  // between syncs.
  const spendCapPatch =
    billingMode === 'usage' && store.paygSpendCapUsdCents === null
      ? { paygSpendCapUsdCents: DEFAULT_PAYG_SPEND_CAP_USD_CENTS }
      : {};

  await app.db
    .update(schema.shopifyStores)
    .set({
      planHandle,
      subscriptionStatus,
      billingMode,
      subscriptionIsTest: subscription.test,
      ...spendCapPatch,
      ...marker,
      lastBillingSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, store.id));

  // Reconciliation: the App Events API always returns 202 even when billing
  // validation fails server-side, with no webhook for that failure — this is
  // the only machine-readable signal that closes the gap between "we sent
  // it" and "Shopify actually billed it". A mismatch here means something is
  // silently wrong (a misconfigured meter handle, an unmetered plan) and is
  // otherwise invisible.
  if (billingMode === 'usage') {
    const reportedLineItem = subscription.lineItems.find((li) => li.usageBalanceUsdCents != null);
    if (reportedLineItem?.usageBalanceUsdCents != null) {
      const ourTotal = await getPaygSpendThisCycleCentsForReconciliation(app, store.id, periodEnd);
      const mismatch = Math.abs(reportedLineItem.usageBalanceUsdCents - ourTotal);
      if (mismatch > 50) {
        // > 50 cents tolerance absorbs ordinary async-processing lag between
        // an event being reported and Shopify's balance reflecting it.
        app.log.error(
          {
            storeId: store.id,
            shopifyBalanceCents: reportedLineItem.usageBalanceUsdCents,
            ourTotalCents: ourTotal,
          },
          'PAYG usage reconciliation mismatch — check Partner Dashboard meter configuration',
        );
      }
    }
  }

  return { planHandle, subscriptionStatus, creditsGranted, billingMode };
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
