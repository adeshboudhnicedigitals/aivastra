import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { SHOPIFY_API_VERSION, verifyQueryHmac } from './service.js';

/**
 * Activates a Shopify recurring charge for a store: links the store to the chosen
 * plan/charge and adds `plan.includedTryons * SHOPIFY_JOB_COST` to the widget credit
 * balance (additive top-up, not an overwrite).
 *
 * Idempotency: `billingPlanId` is set to the last activated `chargeId`. If this call is
 * a replay of an already-processed charge (Shopify retry, double-clicked return URL),
 * the store's `billingPlanId` (read fresh inside the transaction) will already match
 * `chargeId` — in that case this is a no-op: no credit seed, no ledger row. The check is
 * done inside the same transaction as the update to avoid a race between two
 * near-simultaneous calls for the same charge.
 */
export async function activateCharge(
  app: FastifyInstance,
  storeId: string,
  planId: string,
  chargeId: number,
) {
  await app.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ billingPlanId: schema.shopifyStores.billingPlanId })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId))
      .limit(1)
      .for('update');
    if (!existing) throw new AppError('NOT_FOUND', 404, 'store not found');
    if (existing.billingPlanId === chargeId) {
      // Replay of an already-activated charge — skip credit seed and ledger insert.
      return;
    }
    const [plan] = await tx
      .select()
      .from(schema.shopifyPlans)
      .where(eq(schema.shopifyPlans.id, planId))
      .limit(1);
    if (!plan) throw new AppError('NOT_FOUND', 404, 'plan not found');
    const [store] = await tx
      .update(schema.shopifyStores)
      .set({ shopifyPlanId: planId, billingPlanId: chargeId, updatedAt: new Date() })
      .where(eq(schema.shopifyStores.id, storeId))
      .returning();
    const seed = plan.includedTryons * app.env.SHOPIFY_JOB_COST;
    await tx
      .update(schema.widgetClientCredits)
      .set({
        balance: sql`${schema.widgetClientCredits.balance} + ${seed}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.widgetClientCredits.widgetClientId, store.widgetClientId));
    await tx.insert(schema.widgetCreditLedger).values({
      widgetClientId: store.widgetClientId,
      delta: seed,
      reason: 'SHOPIFY_PLAN_ACTIVATED',
    });
  });
}

export async function shopifyBillingRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/billing/plans', { preHandler: app.requireShopifySession }, async (req) => {
    const plans = await app.db.select().from(schema.shopifyPlans);
    return {
      plans: plans.filter((p) => p.isActive),
      currentPlanId: req.shopifyStore?.shopifyPlanId ?? null,
    };
  });

  app.post('/v1/shopify/billing/select', { preHandler: app.requireShopifySession }, async (req) => {
    const { planId } = req.body as { planId: string };
    const [plan] = await app.db
      .select()
      .from(schema.shopifyPlans)
      .where(eq(schema.shopifyPlans.id, planId))
      .limit(1);
    if (!plan?.isActive) throw new AppError('BAD_REQUEST', 400, 'invalid plan');
    // Create Shopify recurring charge; store planId in returnUrl state for the callback.
    const store = req.shopifyStore;
    if (!store) throw new AppError('FORBIDDEN', 403, 'Store not installed');
    const token = decryptToken(store.accessToken, app.env.SHOPIFY_TOKEN_ENC_KEY ?? '');
    const returnUrl = `${app.env.SHOPIFY_APP_URL}/v1/shopify/billing/callback?planId=${planId}&shop=${store.shopDomain}`;
    const res = await fetch(
      `https://${store.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/recurring_application_charges.json`,
      {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recurring_application_charge: {
            name: plan.name,
            price: (plan.priceCents / 100).toFixed(2),
            trial_days: plan.trialDays,
            return_url: returnUrl,
            test: app.env.NODE_ENV !== 'production',
          },
        }),
      },
    );
    if (!res.ok) throw new AppError('SHOPIFY', 502, 'charge creation failed');
    const { recurring_application_charge: charge } = (await res.json()) as {
      recurring_application_charge: { confirmation_url: string };
    };
    return { confirmationUrl: charge.confirmation_url };
  });

  app.get('/v1/shopify/billing/callback', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!verifyQueryHmac(q, app.env.SHOPIFY_API_SECRET ?? '')) {
      throw new AppError('FORBIDDEN', 403, 'bad hmac');
    }
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopDomain, q.shop))
      .limit(1);
    if (!store) throw new AppError('NOT_FOUND', 404, 'store not found');
    await activateCharge(app, store.id, q.planId, Number(q.charge_id));
    return reply.redirect(`${app.env.SHOPIFY_APP_URL}/embedded?shop=${q.shop}&billing=active`);
  });
}
