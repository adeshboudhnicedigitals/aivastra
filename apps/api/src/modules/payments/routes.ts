import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const GST_RATE = 0.18;

const PLANS = {
  starter: { credits: 2500, basePaise: 250_000, label: 'Starter Pack' },
  growth: { credits: 5000, basePaise: 500_000, label: 'Growth Pack' },
  pro: { credits: 10_000, basePaise: 1_000_000, label: 'Pro Pack' },
} as const;

type PlanId = keyof typeof PLANS;

async function createRazorpayOrder(
  keyId: string,
  keySecret: string,
  amountPaise: number,
  receipt: string,
): Promise<{ id: string }> {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay order creation failed: ${body}`);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function paymentsRoutes(app: FastifyInstance) {
  // POST /v1/payments/orders — create a Razorpay order server-side
  app.post(
    '/v1/payments/orders',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({ planId: z.enum(['starter', 'growth', 'pro']) }),
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const { planId } = req.body as { planId: PlanId };
      const plan = PLANS[planId];
      const gstPaise = Math.round(plan.basePaise * GST_RATE);
      const totalPaise = plan.basePaise + gstPaise;

      const rzpOrder = await createRazorpayOrder(
        RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET,
        totalPaise,
        `aivastra_${req.userId.slice(0, 8)}`,
      );

      await app.db.insert(schema.payments).values({
        userId: req.userId,
        planId,
        razorpayOrderId: rzpOrder.id,
        basePaise: plan.basePaise,
        gstPaise,
        totalPaise,
        credits: plan.credits,
        status: 'created',
      });

      return {
        orderId: rzpOrder.id,
        amount: totalPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        credits: plan.credits,
        label: plan.label,
      };
    },
  );

  // POST /v1/payments/verify — verify Razorpay signature + credit user
  app.post(
    '/v1/payments/verify',
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

      // Verify HMAC-SHA256 signature
      const expected = createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (expected !== razorpaySignature) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }

      // Load the pending payment row — must belong to this user
      const [payment] = await app.db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.razorpayOrderId, razorpayOrderId));

      if (!payment) throw new AppError('NOT_FOUND', 404, 'order not found');
      if (payment.userId !== req.userId) throw new AppError('FORBIDDEN', 403, 'forbidden');
      if (payment.status === 'paid') return { ok: true, alreadyCredited: true };

      // Mark paid + credit user atomically
      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.payments)
          .set({
            status: 'paid',
            razorpayPaymentId,
            razorpaySignature,
            paidAt: new Date(),
          })
          .where(eq(schema.payments.razorpayOrderId, razorpayOrderId));

        await tx
          .insert(schema.userCredits)
          .values({ userId: req.userId, balance: payment.credits })
          .onConflictDoUpdate({
            target: schema.userCredits.userId,
            set: {
              balance: sql`${schema.userCredits.balance} + ${payment.credits}`,
              updatedAt: new Date(),
            },
          });

        await tx.insert(schema.creditLedger).values({
          userId: req.userId,
          delta: payment.credits,
          reason: 'PAYMENT',
          adminId: null,
        });
      });

      const [bal] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, req.userId));

      return { ok: true, alreadyCredited: false, balance: bal?.balance ?? payment.credits };
    },
  );
}
