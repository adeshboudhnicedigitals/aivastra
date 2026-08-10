import { AppError } from '../../lib/errors.js';

// Bumped alongside SHOPIFY_API_VERSION in service.ts — the Partner API
// versions independently of the Admin API but this codebase keeps them in
// lockstep for simplicity since both are bumped together in practice.
const PARTNER_API_VERSION = '2026-07';

export interface ActiveSubscription {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: Array<{ handle: string }>;
}

interface PartnerEnv {
  SHOPIFY_PARTNER_API_TOKEN?: string;
  SHOPIFY_PARTNER_ORG_ID?: string;
  SHOPIFY_PARTNER_APP_GID?: string;
}

interface ActiveSubscriptionResponse {
  activeSubscription: ActiveSubscription | null;
}

const ACTIVE_SUBSCRIPTION_QUERY = `
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      billingPeriod
      cancelAtEndOfCycle
      currentBillingCycle {
        startTime
        endTime
      }
      items {
        handle
      }
    }
  }
`;

interface GraphQLBody<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function partnerGraphQL<T>(
  env: PartnerEnv,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (!env.SHOPIFY_PARTNER_API_TOKEN || !env.SHOPIFY_PARTNER_ORG_ID) {
    throw new AppError('CONFIG', 500, 'Shopify Partner API is not configured');
  }
  const url = `https://partners.shopify.com/${env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_PARTNER_API_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new AppError('SHOPIFY', 502, `Partner API request failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as GraphQLBody<T>;
  if (body.errors?.length) {
    throw new AppError('SHOPIFY', 502, `Partner API error: ${body.errors[0]?.message}`);
  }
  if (!body.data) {
    throw new AppError('SHOPIFY', 502, 'Partner API returned no data');
  }
  return body.data;
}

/**
 * Canonical "what is this merchant subscribed to right now?" check. Returns
 * null when the shop has no active Shopify App Pricing contract for this app
 * (never installed a plan, cancelled, or the subscription expired).
 */
export async function getActiveSubscription(
  env: PartnerEnv,
  shopifyShopId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActiveSubscription | null> {
  if (!env.SHOPIFY_PARTNER_APP_GID) {
    throw new AppError('CONFIG', 500, 'Shopify Partner API is not configured');
  }
  const data = await partnerGraphQL<ActiveSubscriptionResponse>(
    env,
    ACTIVE_SUBSCRIPTION_QUERY,
    { appId: env.SHOPIFY_PARTNER_APP_GID, shopId: `gid://shopify/Shop/${shopifyShopId}` },
    fetchImpl,
  );
  return data.activeSubscription;
}
