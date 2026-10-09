import type { Env } from '../../env.js';

/**
 * The only programmatic signal that Shopify actually COLLECTED a one-time
 * charge. The Admin API's AppPurchaseOneTime.status stops at ACTIVE, which
 * means "approved and invoiced" — collection happens afterwards and can fail
 * (seen on production 2026-10-09). An AppOneTimeSale transaction is recorded
 * only once the merchant has paid, and carries the charge id.
 *
 * Partner API, not Admin API: org-scoped token ("View financials" only),
 * 4 req/s per client. The token is never logged.
 */

const API_VERSION = '2026-10';
const PAGE_DELAY_MS = 300;
const TIMEOUT_MS = 15_000;

export type PartnerApiFailure = 'missing_config' | 'http' | 'graphql' | 'rate_limited';

export class PartnerApiError extends Error {
  constructor(
    readonly reason: PartnerApiFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

export interface OneTimeSale {
  paidAt: Date;
}

export type PartnerApiEnv = Pick<Env, 'SHOPIFY_PARTNER_API_TOKEN' | 'SHOPIFY_PARTNER_ORG_ID'>;

export type FetchOneTimeSales = (
  env: PartnerApiEnv,
  args: { since: Date; shop?: string },
) => Promise<Map<string, OneTimeSale>>;

/**
 * The Admin API hands us a gid (gid://shopify/AppPurchaseOneTime/N) and the
 * Partner API may format the same charge differently, so both sides are
 * compared on the trailing number only.
 */
export function numericChargeId(id: string): string {
  return id.split('/').pop() ?? id;
}

const QUERY = `
  query OneTimeSales($types: [TransactionType!], $shop: String, $since: DateTime, $after: String) {
    transactions(first: 100, types: $types, myshopifyDomain: $shop, createdAtMin: $since, after: $after) {
      edges {
        cursor
        node {
          id
          createdAt
          ... on AppOneTimeSale { chargeId }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface SaleNode {
  id: string;
  createdAt: string;
  chargeId?: string | null;
}

export const fetchOneTimeSales: FetchOneTimeSales = async (env, { since, shop }) => {
  const token = env.SHOPIFY_PARTNER_API_TOKEN;
  const orgId = env.SHOPIFY_PARTNER_ORG_ID;
  if (!token || !orgId) {
    throw new PartnerApiError(
      'missing_config',
      'SHOPIFY_PARTNER_API_TOKEN and SHOPIFY_PARTNER_ORG_ID must both be set',
    );
  }

  const endpoint = `https://partners.shopify.com/${orgId}/api/${API_VERSION}/graphql.json`;
  const sales = new Map<string, OneTimeSale>();
  let after: string | undefined;

  for (;;) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({
          query: QUERY,
          variables: { types: ['APP_ONE_TIME_SALE'], shop, since: since.toISOString(), after },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new PartnerApiError('http', `Partner API request failed: ${(err as Error).message}`);
    }
    if (res.status === 429) throw new PartnerApiError('rate_limited', 'Partner API rate limited');
    if (!res.ok) {
      // Shopify's error text, never our token.
      // A body that fails to stream must not escape as a raw error.
      const detail = await res.text().then(
        (t) => t.slice(0, 300),
        () => '(response body unreadable)',
      );
      throw new PartnerApiError('http', `Partner API HTTP ${res.status}: ${detail}`);
    }

    // A 200 can still carry an HTML proxy/CDN error page; res.json() would
    // throw a raw SyntaxError. Hint is truncated and never includes the token.
    let body: {
      data?: {
        transactions?: {
          edges?: unknown;
          pageInfo?: { hasNextPage?: boolean } | null;
        } | null;
      } | null;
      errors?: Array<{ message: string }>;
    };
    try {
      body = await res.json();
    } catch (err) {
      throw new PartnerApiError(
        'http',
        `Partner API returned a non-JSON 200 body: ${(err as Error).message.slice(0, 100)}`,
      );
    }
    if (body?.errors?.length || !body?.data) {
      throw new PartnerApiError(
        'graphql',
        `Partner API errors: ${(body?.errors ?? []).map((e) => e.message).join('; ') || 'no data'}`,
      );
    }

    // Shape guard before destructuring: a null/missing connection must fail
    // closed, not become a TypeError or an empty (looks-like-"unpaid") Map.
    const tx = body.data.transactions;
    if (!tx || !Array.isArray(tx.edges)) {
      throw new PartnerApiError('graphql', 'Partner API response missing transactions.edges');
    }
    const edges = tx.edges as Array<{ cursor: string; node: SaleNode }>;
    const hasNextPage = tx.pageInfo?.hasNextPage === true;
    for (const { node } of edges) {
      // chargeId is null for sales before September 2020 — nothing to match.
      if (node.chargeId) {
        const paidAt = new Date(node.createdAt);
        // An Invalid Date would silently defeat any later date comparison.
        if (Number.isNaN(paidAt.getTime())) {
          throw new PartnerApiError(
            'graphql',
            `Partner API sale ${node.id} has an unparseable createdAt`,
          );
        }
        sales.set(numericChargeId(node.chargeId), { paidAt });
      }
    }
    if (!hasNextPage) break;
    // More pages promised but no cursor to follow: the result is truncated,
    // so returning it as success would hide sales that may have been paid.
    if (edges.length === 0) {
      throw new PartnerApiError('graphql', 'Partner API reported hasNextPage with no edges');
    }
    after = edges[edges.length - 1].cursor;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return sales;
};
