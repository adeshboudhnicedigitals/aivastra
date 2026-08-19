import type { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { shopifyGraphQL } from './service.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;

interface UserError {
  field: string[] | null;
  message: string;
}

/**
 * A usage-only subscription: `lineItems` carries just appUsagePricingDetails,
 * with no appRecurringPricingDetails at all. Verified supported on shopify.dev
 * — there is no $0 base line and no nominal base fee, so the merchant is billed
 * strictly for refills they actually received.
 *
 * `cappedAmount` is the ceiling the merchant approves once. Every refill after
 * that needs no approval while the cycle's cumulative total stays under it.
 */
const CREATE_SUBSCRIPTION = `
  mutation CreateAutorefillSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl
      appSubscription {
        id
        status
        lineItems {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_USAGE_RECORD = `
  mutation CreateAutorefillUsageRecord(
    $subscriptionLineItemId: ID!
    $description: String!
    $price: MoneyInput!
    $idempotencyKey: String!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      description: $description
      price: $price
      idempotencyKey: $idempotencyKey
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_CAPPED_AMOUNT = `
  mutation UpdateAutorefillCap($id: ID!, $cappedAmount: MoneyInput!) {
    appSubscriptionLineItemUpdate(id: $id, cappedAmount: $cappedAmount) {
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION = `
  mutation CancelAutorefillSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function throwOnUserErrors(errors: UserError[] | undefined, context: string): void {
  if (errors?.length) {
    throw new AppError('SHOPIFY', 502, `${context}: ${errors.map((e) => e.message).join('; ')}`);
  }
}

export async function createUsageSubscription(
  app: FastifyInstance,
  store: Store,
  args: {
    name: string;
    terms: string;
    cappedAmountUsd: number;
    returnUrl: string;
    test: boolean;
  },
): Promise<{ confirmationUrl: string; subscriptionId: string; lineItemId: string }> {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      appSubscription: { id: string; status: string; lineItems: Array<{ id: string }> } | null;
      userErrors: UserError[];
    };
  }>(store.shopDomain, accessToken, CREATE_SUBSCRIPTION, {
    name: args.name,
    returnUrl: args.returnUrl,
    test: args.test,
    lineItems: [
      {
        plan: {
          appUsagePricingDetails: {
            terms: args.terms,
            cappedAmount: { amount: args.cappedAmountUsd.toFixed(2), currencyCode: 'USD' },
          },
        },
      },
    ],
  });

  const payload = data.appSubscriptionCreate;
  throwOnUserErrors(payload.userErrors, 'auto-refill subscription');

  const lineItemId = payload.appSubscription?.lineItems?.[0]?.id;
  if (!payload.confirmationUrl || !payload.appSubscription || !lineItemId) {
    throw new AppError('SHOPIFY', 502, 'Shopify returned an incomplete auto-refill subscription');
  }

  return {
    confirmationUrl: payload.confirmationUrl,
    subscriptionId: payload.appSubscription.id,
    lineItemId,
  };
}

/**
 * Charges one refill.
 *
 * Returns a discriminated result rather than throwing on the cap case, because
 * hitting a merchant-set ceiling is a normal outcome — the ceiling working as
 * intended — and must not be handled by the same path as a network fault.
 *
 * `idempotencyKey` is Shopify's own duplicate-charge protection: a repeat with
 * the same key does not create a second charge. This is the only guard that
 * helps when we time out on a request Shopify actually accepted, which no
 * amount of application-side locking can detect.
 */
export async function createUsageRecord(
  app: FastifyInstance,
  store: Store,
  args: {
    lineItemId: string;
    description: string;
    amountUsd: number;
    idempotencyKey: string;
  },
): Promise<{ ok: true; recordId: string } | { ok: false; capReached: boolean; message: string }> {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{
    appUsageRecordCreate: {
      appUsageRecord: { id: string } | null;
      userErrors: UserError[];
    };
  }>(store.shopDomain, accessToken, CREATE_USAGE_RECORD, {
    subscriptionLineItemId: args.lineItemId,
    description: args.description,
    price: { amount: args.amountUsd.toFixed(2), currencyCode: 'USD' },
    idempotencyKey: args.idempotencyKey,
  });

  const payload = data.appUsageRecordCreate;
  if (payload.userErrors?.length) {
    const message = payload.userErrors.map((e) => e.message).join('; ');
    // Shopify phrases cap exhaustion two ways depending on the surface
    // ("Failed to create usage charge" and "Total price exceeds balance
    // remaining"). Match on both rather than on one, and treat anything
    // unrecognized as a genuine failure rather than silently assuming the cap.
    const capReached =
      /exceeds balance remaining/i.test(message) || /failed to create usage charge/i.test(message);
    return { ok: false, capReached, message };
  }

  const recordId = payload.appUsageRecord?.id;
  if (!recordId) {
    return { ok: false, capReached: false, message: 'Shopify returned no usage record' };
  }
  return { ok: true, recordId };
}

/**
 * Raising the ceiling needs fresh merchant approval — Shopify returns a
 * confirmation URL and refuses further usage records until it is approved. So
 * this cannot be called to self-heal a CAP_REACHED store; it is the first half
 * of a merchant-facing flow.
 */
export async function updateCappedAmount(
  app: FastifyInstance,
  store: Store,
  args: { lineItemId: string; cappedAmountUsd: number },
): Promise<{ confirmationUrl: string }> {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{
    appSubscriptionLineItemUpdate: {
      confirmationUrl: string | null;
      userErrors: UserError[];
    };
  }>(store.shopDomain, accessToken, UPDATE_CAPPED_AMOUNT, {
    id: args.lineItemId,
    cappedAmount: { amount: args.cappedAmountUsd.toFixed(2), currencyCode: 'USD' },
  });

  const payload = data.appSubscriptionLineItemUpdate;
  throwOnUserErrors(payload.userErrors, 'auto-refill cap update');
  if (!payload.confirmationUrl) {
    throw new AppError('SHOPIFY', 502, 'Shopify returned no confirmation URL for the cap update');
  }
  return { confirmationUrl: payload.confirmationUrl };
}

export async function cancelSubscription(
  app: FastifyInstance,
  store: Store,
  subscriptionId: string,
): Promise<void> {
  const accessToken = await getValidAccessToken(app, store);
  const data = await shopifyGraphQL<{
    appSubscriptionCancel: {
      appSubscription: { id: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(store.shopDomain, accessToken, CANCEL_SUBSCRIPTION, { id: subscriptionId });
  throwOnUserErrors(data.appSubscriptionCancel.userErrors, 'auto-refill cancel');
}
