import type { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { shopifyGraphQL } from './service.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Real `AppSubscriptionStatus` enum values from the Admin GraphQL schema.
 * `ACCEPTED` also exists but is deprecated — never match on it.
 */
export type AppSubscriptionStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FROZEN'
  | 'PENDING';

export interface ActiveSubscription {
  id: string;
  /**
   * The subscription's display name, as configured for the plan in Partner
   * Dashboard. The Admin API has no plan *handle* — this string is the only
   * link back to our credit mapping, so billing-plans.ts matches it
   * case-insensitively rather than exactly.
   */
  name: string;
  status: AppSubscriptionStatus;
  /** ISO-8601. Null on subscriptions that have no dated period yet. */
  currentPeriodEnd: string | null;
  test: boolean;
  lineItems: Array<{
    id: string;
    // Optional, not `| null` at the required-key level: the existing
    // sub() test fixture in shopify-billing-sync.test.ts (and every new
    // override built on it in Task 4) constructs lineItems literals that
    // predate this field and must keep typechecking without adding it.
    usageBalanceUsdCents?: number | null;
  }>;
}

/**
 * Takes no arguments on purpose: `currentAppInstallation` resolves against
 * whichever shop's access token authenticates the request, so the per-store
 * Admin API client already scopes it. There is no app-wide/org-wide variant of
 * this read — the Partner API's `activeSubscription(appId:, shopId:)` field
 * this replaces does not exist in Shopify's schema at all.
 */
const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        test
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppUsagePricing {
                balanceUsed {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface ActiveSubscriptionsResponse {
  currentAppInstallation: { activeSubscriptions: ActiveSubscription[] } | null;
}

/**
 * Canonical "what is this merchant subscribed to right now?" check. Returns
 * null when the shop has no Shopify App Pricing contract for this app at all
 * (never picked a plan, or the subscription was cancelled and cleared).
 *
 * `activeSubscriptions` is a list. In practice a shop carries at most one
 * app-pricing subscription, but the shape allows more, so prefer the `ACTIVE`
 * one and otherwise surface the first entry — a `FROZEN`/`PENDING`/`DECLINED`
 * subscription must stay visible to the caller so the store's real status can
 * be persisted instead of being flattened to "cancelled".
 */
export async function getActiveSubscription(
  app: FastifyInstance,
  store: Store,
): Promise<ActiveSubscription | null> {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<ActiveSubscriptionsResponse>(
    store.shopDomain,
    accessToken,
    ACTIVE_SUBSCRIPTIONS_QUERY,
  );
  const rawSubscriptions = data.currentAppInstallation?.activeSubscriptions ?? [];
  const subscriptions: ActiveSubscription[] = rawSubscriptions.map((raw) => {
    // biome-ignore lint/suspicious/noExplicitAny: raw GraphQL response before mapping to the typed shape
    const r = raw as any;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      currentPeriodEnd: r.currentPeriodEnd,
      test: r.test,
      lineItems: (r.lineItems ?? []).map(
        (li: {
          id: string;
          plan?: { pricingDetails?: { __typename?: string; balanceUsed?: { amount?: string } } };
        }) => ({
          id: li.id,
          usageBalanceUsdCents:
            li.plan?.pricingDetails?.__typename === 'AppUsagePricing' &&
            li.plan.pricingDetails.balanceUsed?.amount
              ? Math.round(Number.parseFloat(li.plan.pricingDetails.balanceUsed.amount) * 100)
              : null,
        }),
      ),
    };
  });
  const [first] = subscriptions;
  if (!first) return null;
  return subscriptions.find((s) => s.status === 'ACTIVE') ?? first;
}
