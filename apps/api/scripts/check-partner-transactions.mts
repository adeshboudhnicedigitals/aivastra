/**
 * Answers one question: has Shopify actually collected payment for these
 * one-time charges?
 *
 * The Admin API can't tell you. `AppPurchaseOneTime.status` stops at ACTIVE,
 * which means "approved and invoiced", not "paid" — on 2026-10-09 two $1 test
 * charges both reached ACTIVE and both granted credits, yet one invoice was
 * Paid and the other Failed. No webhook fires on collection either. The only
 * signal is the Partner API: an `AppOneTimeSale` transaction is recorded once
 * the merchant has paid, carrying the charge id. See docs/progress.md
 * (2026-10-09) for the full finding.
 *
 * Read-only: Partner API GraphQL queries only, no database, no Admin API.
 * Needs a Partner API client token with "View financials" — created by the
 * Partner org owner, scoped to the whole org rather than one store.
 *
 *   pnpm check:partner-transactions -- 3321168113 3321135345
 *   pnpm check:partner-transactions -- --shop example.myshopify.com --since 2026-10-01 3321168113
 *
 * Charge ids may be bare numbers or full gids. `--app` filters by
 * SHOPIFY_PARTNER_APP_ID; it is off by default because that env var can point at
 * a different app (e.g. the dev app) than the one the charges were made on, and
 * a wrong filter silently returns nothing — indistinguishable from "unpaid".
 *
 * Env: SHOPIFY_PARTNER_API_TOKEN, SHOPIFY_PARTNER_ORG_ID, optional
 * SHOPIFY_PARTNER_APP_ID. The token is never printed.
 */

const API_VERSION = '2026-10';

interface Args {
  chargeIds: string[];
  shop?: string;
  since?: string;
  useApp: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { chargeIds: [], useApp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--shop') args.shop = argv[++i];
    // DateTime rejects a bare date, so 2026-10-01 becomes midnight UTC.
    else if (a === '--since') {
      const v = argv[++i];
      args.since = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
    } else if (a === '--app') args.useApp = true;
    else args.chargeIds.push(a);
  }
  return args;
}

/** "gid://shopify/AppPurchaseOneTime/3321168113" and "3321168113" compare equal. */
function numericId(id: string): string {
  return id.split('/').pop() ?? id;
}

const QUERY = `
  query OneTimeSales($types: [TransactionType!], $shop: String, $appId: ID, $since: DateTime, $after: String) {
    transactions(first: 100, types: $types, myshopifyDomain: $shop, appId: $appId, createdAtMin: $since, after: $after) {
      edges {
        cursor
        node {
          id
          createdAt
          ... on AppOneTimeSale {
            chargeId
            grossAmount { amount currencyCode }
            netAmount { amount currencyCode }
            shop { myshopifyDomain }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface Sale {
  id: string;
  createdAt: string;
  chargeId: string | null;
  grossAmount: { amount: string; currencyCode: string } | null;
  netAmount: { amount: string; currencyCode: string };
  shop: { myshopifyDomain: string } | null;
}

async function main() {
  // The local .env may set NODE_TLS_REJECT_UNAUTHORIZED=0 for other tooling; an
  // org-wide financials token must never go out over an unverified connection.
  // Deleted before the first TLS connect, so Node verifies certificates again.
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  const token = process.env.SHOPIFY_PARTNER_API_TOKEN;
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  if (!token || !orgId) {
    console.error('SHOPIFY_PARTNER_API_TOKEN and SHOPIFY_PARTNER_ORG_ID must be set');
    process.exit(2);
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.chargeIds.length === 0) {
    console.error(
      'usage: check-partner-transactions [--shop <domain>] [--since <ISO date>] [--app] <chargeId>...',
    );
    process.exit(2);
  }

  const appIdRaw = process.env.SHOPIFY_PARTNER_APP_ID;
  if (args.useApp && !appIdRaw) {
    console.error('--app given but SHOPIFY_PARTNER_APP_ID is not set');
    process.exit(2);
  }
  const appId =
    appIdRaw && args.useApp
      ? appIdRaw.startsWith('gid://')
        ? appIdRaw
        : `gid://partners/App/${appIdRaw}`
      : undefined;

  const endpoint = `https://partners.shopify.com/${orgId}/api/${API_VERSION}/graphql.json`;
  const sales: Sale[] = [];
  let after: string | undefined;

  for (;;) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          types: ['APP_ONE_TIME_SALE'],
          shop: args.shop,
          appId,
          since: args.since,
          after,
        },
      }),
    });
    if (!res.ok) {
      // Body is Shopify's error text, never our token — safe to show.
      console.error(`Partner API HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
      process.exit(1);
    }
    const body = (await res.json()) as {
      data?: {
        transactions: {
          edges: Array<{ cursor: string; node: Sale }>;
          pageInfo: { hasNextPage: boolean };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      console.error('Partner API errors:', body.errors.map((e) => e.message).join('; '));
      process.exit(1);
    }
    const page = body.data?.transactions;
    if (!page) {
      console.error('Partner API returned no transactions field');
      process.exit(1);
    }
    sales.push(...page.edges.map((e) => e.node));
    if (!page.pageInfo.hasNextPage || page.edges.length === 0) break;
    after = page.edges[page.edges.length - 1].cursor;
    // Partner API allows 4 req/s per client; stay well under it.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `scanned ${sales.length} APP_ONE_TIME_SALE transaction(s)` +
      `${args.shop ? ` for ${args.shop}` : ''}${args.since ? ` since ${args.since}` : ''}` +
      `${appId ? ` on ${appId}` : ' across all apps in the org'}\n`,
  );

  let unpaid = 0;
  for (const raw of args.chargeIds) {
    const want = numericId(raw);
    const match = sales.find((s) => s.chargeId && numericId(s.chargeId) === want);
    if (match) {
      console.log(
        `PAID    ${want}  recorded ${match.createdAt}  gross ${match.grossAmount?.amount ?? '?'} ${match.grossAmount?.currencyCode ?? ''}` +
          `  net ${match.netAmount.amount} ${match.netAmount.currencyCode}  shop ${match.shop?.myshopifyDomain ?? '?'}`,
      );
    } else {
      unpaid++;
      console.log(
        `NO TXN  ${want}  — no AppOneTimeSale recorded (unpaid, not yet settled, or filtered out)`,
      );
    }
  }

  // exitCode, not exit(): exiting with fetch sockets still open trips a libuv
  // assertion on Windows.
  process.exitCode = unpaid > 0 ? 3 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
