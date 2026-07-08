import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { verifyQueryHmac } from './service.js';

/**
 * Activates a Shopify recurring charge for a store: links the store to the chosen
 * plan/charge and resets (NOT tops up) the widget credit balance to
 * `plan.includedTryons * SHOPIFY_JOB_COST`.
 *
 * NOTE (flagged for reviewer, see task-11 self-review): this is an overwrite, not an
 * additive top-up. If a store re-activates the same plan (double-fire callback) this
 * is harmless (same seed both times), but if a merchant switches plans mid-cycle after
 * spending some credits, or the callback fires twice with usage in between, this
 * discards the existing balance rather than adding to it. Implemented per the brief's
 * explicit pseudocode; not silently changed to additive.
 */
export async function activateCharge(
  app: FastifyInstance,
  storeId: string,
  planId: string,
  chargeId: number,
) {
  await app.db.transaction(async (tx) => {
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
      .set({ balance: seed, updatedAt: new Date() })
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
      `https://${store.shopDomain}/admin/api/2024-01/recurring_application_charges.json`,
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
