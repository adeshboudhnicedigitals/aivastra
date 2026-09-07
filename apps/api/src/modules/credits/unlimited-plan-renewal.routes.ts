// Self-serve renewal for an admin-granted unlimited plan, from the pricing
// page's "Renew" button/confirm popup — same GSTIN + GST-inclusive checkout
// as every other purchasable pack (see /v1/payments/orders). The base price
// is the negotiated one the admin set on the plan (unlimited_plans.pricePaise);
// 18% GST is added on top and charged fresh every renewal, same as a pack
// purchase, though this never becomes a `credit_plans` SKU. A plan an admin
// has revoked can't be self-renewed — that requires the admin to re-grant,
// same as today.
import { schema } from '@aivastra/db';
import { Gstin } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createRazorpayOrder, verifyRazorpayPaymentSignature } from '../../lib/razorpay.js';
import { deriveDisplayStatus, getLatestUnlimitedPlan } from './unlimited-plan.js';
import { applyUnlimitedPlanRenewalPayment } from './unlimited-plan-renewal.js';

const GST_RATE = 0.18;

export async function unlimitedPlanRenewalRoutes(app: FastifyInstance) {
  // POST /v1/unlimited-plan/renew/order — create a Razorpay order for this
  // user's own unlimited plan, at the price the admin last set for them plus GST.
  app.post(
    '/v1/unlimited-plan/renew/order',
    {
      preHandler: app.requireUser,
      schema: { body: z.object({ gstin: Gstin }).nullish() },
    },
    async (req) => {
      const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const { gstin } = (req.body as { gstin?: string } | undefined) ?? {};
      const normalizedGstin = gstin?.trim().toUpperCase() || null;

      const plan = await getLatestUnlimitedPlan(app.db, req.userId);
      if (!plan) throw new AppError('NOT_FOUND', 404, 'no monthly plan found for this account');
      if (plan.status === 'revoked') {
        throw new AppError('FORBIDDEN', 403, 'this monthly plan was revoked — contact support');
      }
      if (plan.pricePaise <= 0) {
        throw new AppError(
          'NOT_CONFIGURED',
          400,
          'no renewal price set for this plan — contact support',
        );
      }

      const gstPaise = Math.round(plan.pricePaise * GST_RATE);
      const totalPaise = plan.pricePaise + gstPaise;

      const rzpOrder = await createRazorpayOrder(
        RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET,
        totalPaise,
        `aivastra_unl_${req.userId.slice(0, 8)}`,
      );

      await app.db.insert(schema.unlimitedPlanCharges).values({
        unlimitedPlanId: plan.id,
        userId: req.userId,
        pricePaise: plan.pricePaise,
        gstPaise,
        totalPaise,
        gstin: normalizedGstin,
        chargeType: 'renewal',
        chargedBy: req.userId,
        status: 'pending',
        razorpayOrderId: rzpOrder.id,
      });

      return {
        orderId: rzpOrder.id,
        amount: totalPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        label: 'Monthly Plan Renewal',
      };
    },
  );

  // POST /v1/unlimited-plan/renew/verify — verify Razorpay signature + extend the plan
  app.post(
    '/v1/unlimited-plan/renew/verify',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          razorpayOrderId: z.string().min(1),
          razorpayPaymentId: z.string().min(1),
          razorpaySignature: z.string().min(1),
        }),
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      };

      const signatureValid = verifyRazorpayPaymentSignature(
        RAZORPAY_KEY_SECRET,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      );
      if (!signatureValid) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }

      const [charge] = await app.db
        .select()
        .from(schema.unlimitedPlanCharges)
        .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, razorpayOrderId));
      if (!charge) throw new AppError('NOT_FOUND', 404, 'order not found');
      if (charge.userId !== req.userId) throw new AppError('FORBIDDEN', 403, 'forbidden');

      const result = await applyUnlimitedPlanRenewalPayment(
        app,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      );
      if (!result.handled) throw new AppError('NOT_FOUND', 404, 'order not found');

      const [plan] = await app.db
        .select()
        .from(schema.unlimitedPlans)
        .where(eq(schema.unlimitedPlans.id, charge.unlimitedPlanId));

      return { ok: true, unlimitedPlan: deriveDisplayStatus(plan ?? null) };
    },
  );
}
