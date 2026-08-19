import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import {
  getShopifyPackCredits,
  getShopifyTrialCredits,
  getTryonCreditCost,
} from '../../lib/resolution-config.js';
import { grantStore } from '../credits/shopify-ledger.js';
import { getPack } from './packs.js';
import { shopifyGraphQL } from './service.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;

export interface OneTimePurchaseState {
  id: string;
  status: string;
  test: boolean;
}

const CREATE_PURCHASE_MUTATION = `
  mutation CreateCreditPackPurchase($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean!) {
    appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
      confirmationUrl
      appPurchaseOneTime {
        id
        status
        test
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * node(id:) rather than paginating currentAppInstallation.oneTimePurchases —
 * AppPurchaseOneTime implements Node, so a store with a long purchase history
 * costs one lookup instead of a page walk.
 */
const PURCHASE_STATUS_QUERY = `
  query CreditPackPurchaseStatus($id: ID!) {
    node(id: $id) {
      ... on AppPurchaseOneTime {
        id
        status
        test
      }
    }
  }
`;

interface CreateDeps {
  createCharge?: (
    app: FastifyInstance,
    store: Store,
    args: { name: string; amountUsd: number; returnUrl: string; test: boolean },
  ) => Promise<{ confirmationUrl: string; purchase: OneTimePurchaseState }>;
}

async function defaultCreateCharge(
  app: FastifyInstance,
  store: Store,
  args: { name: string; amountUsd: number; returnUrl: string; test: boolean },
) {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{
    appPurchaseOneTimeCreate: {
      confirmationUrl: string | null;
      appPurchaseOneTime: OneTimePurchaseState | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(store.shopDomain, accessToken, CREATE_PURCHASE_MUTATION, {
    name: args.name,
    price: { amount: args.amountUsd.toFixed(2), currencyCode: 'USD' },
    returnUrl: args.returnUrl,
    test: args.test,
  });

  const payload = data.appPurchaseOneTimeCreate;
  if (payload.userErrors?.length) {
    throw new AppError('SHOPIFY', 502, payload.userErrors.map((e) => e.message).join('; '));
  }
  if (!payload.confirmationUrl || !payload.appPurchaseOneTime) {
    throw new AppError('SHOPIFY', 502, 'Shopify returned no confirmation URL for the charge');
  }
  return { confirmationUrl: payload.confirmationUrl, purchase: payload.appPurchaseOneTime };
}

/**
 * Starts a manual credit-pack purchase.
 *
 * The row is INSERTed *before* the charge is created so a Shopify failure
 * leaves an auditable FAILED row rather than nothing at all — "we tried and
 * Shopify refused" is a materially different fact from "the merchant never
 * clicked", and only the row can tell them apart afterwards.
 *
 * `test` mirrors the store's own environment gate rather than being hardcoded:
 * a development store can only ever be charged in test mode, and production
 * must never issue one.
 */
export async function createPurchase(
  app: FastifyInstance,
  store: Store,
  packId: string,
  deps: CreateDeps = {},
): Promise<{ purchaseId: string; confirmationUrl: string }> {
  const createCharge = deps.createCharge ?? defaultCreateCharge;

  const pack = getPack(packId);
  if (!pack) throw new AppError('BAD_REQUEST', 400, 'unknown pack');

  // SHOPIFY_APP_URL is optional in the env schema, and interpolating an
  // undefined into the return URL would strand a merchant on a broken page
  // *after* they had already been charged. Fail before creating the charge.
  if (!app.env.SHOPIFY_APP_URL) {
    throw new AppError('CONFIG', 500, 'SHOPIFY_APP_URL is not configured');
  }

  // Snapshotted here, at INSERT — see the shopify_credit_purchases docstring
  // for why the grant must never re-read this later.
  const credits = await getShopifyPackCredits(app, pack.id, 'manual');
  if (credits === null) throw new AppError('BAD_REQUEST', 400, 'unknown pack');

  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: store.id,
      source: 'manual',
      packId: pack.id,
      credits,
      priceUsdCents: Math.round(pack.priceUsd * 100),
      status: 'PENDING',
    })
    .returning({ id: schema.shopifyCreditPurchases.id });

  // Try-ons are the merchant-facing unit — no merchant has an intuition for
  // what 2,250 credits buys, and this string is what Shopify prints on the
  // approval page and the invoice. Derived from the live cost rather than
  // hardcoded so it stays honest if an admin retunes tryon.creditCost.
  const tryOns = Math.floor(credits / (await getTryonCreditCost(app)));
  const returnUrl = `${app.env.SHOPIFY_APP_URL}/shopify-admin/billing/callback?purchase=${row.id}`;

  try {
    const { confirmationUrl, purchase } = await createCharge(app, store, {
      name: `AiVastra — ${tryOns} try-ons`,
      amountUsd: pack.priceUsd,
      returnUrl,
      test: app.env.SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS === true,
    });
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ shopifyChargeId: purchase.id, updatedAt: new Date() })
      .where(eq(schema.shopifyCreditPurchases.id, row.id));
    return { purchaseId: row.id, confirmationUrl };
  } catch (err) {
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(schema.shopifyCreditPurchases.id, row.id));
    throw err;
  }
}

interface ConfirmDeps {
  fetchPurchase?: (
    app: FastifyInstance,
    store: Store,
    chargeId: string,
  ) => Promise<OneTimePurchaseState | null>;
}

/**
 * Re-fetches a charge's real current state from Shopify via node(id:) —
 * shared by confirmPurchase (below) and the app_purchases_one_time/update
 * webhook handler (webhook.routes.ts), so both paths trust the same live
 * read rather than a raw webhook payload field or a locally-remembered status.
 */
export async function defaultFetchPurchase(app: FastifyInstance, store: Store, chargeId: string) {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{ node: OneTimePurchaseState | null }>(
    store.shopDomain,
    accessToken,
    PURCHASE_STATUS_QUERY,
    { id: chargeId },
  );
  return data.node;
}

async function storeBalance(app: FastifyInstance, storeId: string): Promise<number> {
  const [row] = await app.db
    .select({ balance: schema.shopifyStoreCredits.balance })
    .from(schema.shopifyStoreCredits)
    .where(eq(schema.shopifyStoreCredits.storeId, storeId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Grants credits for a purchase Shopify says is ACTIVE.
 *
 * Shared by the merchant-facing confirm route and the
 * APP_PURCHASES_ONE_TIME_UPDATE webhook, which can race each other — a merchant
 * who approves and immediately lands back on our page will often beat the
 * webhook. Idempotency is the external_ref partial unique index on
 * shopify_credit_ledger (migration 0150), keyed on Shopify's own charge id, so
 * whichever arrives first grants and the other reports zero. That, not
 * application-level locking, is what makes this safe — matching the
 * atomicDeduct/refund idiom this codebase already uses.
 */
export async function grantForPurchase(
  app: FastifyInstance,
  purchaseRow: typeof schema.shopifyCreditPurchases.$inferSelect,
  observed: OneTimePurchaseState,
): Promise<number> {
  // Shopify marks a charge `test` when no money will ever change hands — always
  // the case on a development store, which any Partner can create for free and
  // without limit. Granting against one gives product away: once the app is
  // publicly installable, anyone could install on a fresh dev store, buy a
  // pack, take the credits, and repeat. Credits are GPU spend, so that converts
  // straight into cost.
  //
  // `=== true` rather than truthiness: the test harness casts an Env object
  // directly and leaves this undefined, and a gate guarding revenue must read
  // as denied for anything that is not explicitly boolean true.
  const testAllowed = !observed.test || app.env.SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS === true;

  if (observed.test && !testAllowed) {
    app.log.warn(
      { storeId: purchaseRow.storeId, purchaseId: purchaseRow.id },
      'shopify test purchase — no credits granted (set SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS=true to allow)',
    );
    return 0;
  }
  if (observed.status !== 'ACTIVE') return 0;

  // Distinct reason so test-funded credits stay separable from paid ones in the
  // ledger forever. `reason` is free text and is only ever written, so this
  // needs no migration and breaks no reader.
  const reason = observed.test ? 'SHOPIFY_PACK_TEST' : 'SHOPIFY_PACK';
  const externalRef = `shopify_pack:${observed.id}`;
  const { granted } = await grantStore(
    app.db,
    purchaseRow.storeId,
    purchaseRow.credits,
    reason,
    externalRef,
  );
  return granted ? purchaseRow.credits : 0;
}

/**
 * The merchant-facing confirm path, hit after Shopify's approval redirect.
 *
 * The `purchase` param is our own row UUID, never the Shopify GID, and is only
 * ever a lookup key: credits come from the row and the charge's real state comes
 * from Shopify. A merchant editing the URL can at worst point at another store's
 * row, which the storeId check rejects with a 404 — not a 403, which would
 * confirm that row exists.
 */
export async function confirmPurchase(
  app: FastifyInstance,
  store: Store,
  purchaseId: string,
  deps: ConfirmDeps = {},
): Promise<{ status: string; creditsGranted: number; creditBalance: number }> {
  const fetchPurchase = deps.fetchPurchase ?? defaultFetchPurchase;

  const [row] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, purchaseId))
    .limit(1);

  if (!row || row.storeId !== store.id) {
    throw new AppError('NOT_FOUND', 404, 'purchase not found');
  }
  if (!row.shopifyChargeId) {
    return {
      status: row.status,
      creditsGranted: 0,
      creditBalance: await storeBalance(app, store.id),
    };
  }

  const observed = await fetchPurchase(app, store, row.shopifyChargeId);
  if (!observed) {
    throw new AppError('SHOPIFY', 502, 'charge not found at Shopify');
  }

  const creditsGranted = await grantForPurchase(app, row, observed);

  await app.db
    .update(schema.shopifyCreditPurchases)
    .set({ status: observed.status, updatedAt: new Date() })
    .where(eq(schema.shopifyCreditPurchases.id, row.id));

  return {
    status: observed.status,
    creditsGranted,
    creditBalance: await storeBalance(app, store.id),
  };
}

/**
 * Grants the one-time free-tier credits to a store at install time, called from
 * provisionShopifyStore. Independent of any purchase — this exists so a
 * merchant can try the feature before buying anything.
 *
 * Idempotent via the same external_ref index (migration 0150), keyed on store
 * id alone so this is strictly one-time per store: unlinking and relinking the
 * same store does not re-grant, but a different store linked to the same owner
 * does.
 *
 * Moved here verbatim from the deleted billing.ts — it is the 25-credit free
 * tier and has nothing to do with subscriptions.
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
