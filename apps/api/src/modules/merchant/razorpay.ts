import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resolveMerchantUserId } from './ledger.js';

export const GST_RATE = 0.18;

export async function createRazorpayOrder(
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

// Idempotent credit grant to a merchant's (single, unified) credit pool + ledger entry.
export async function grantMerchantCredits(
  app: FastifyInstance,
  merchantId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  credits: number,
  signature?: string,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
  const userId = await resolveMerchantUserId(app.db as any, merchantId);

  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.merchantPayments)
      .set({
        status: 'paid',
        razorpayPaymentId,
        ...(signature ? { razorpaySignature: signature } : {}),
        paidAt: new Date(),
      })
      .where(eq(schema.merchantPayments.razorpayOrderId, razorpayOrderId));

    await tx
      .insert(schema.userCredits)
      .values({ userId, balance: credits })
      .onConflictDoUpdate({
        target: schema.userCredits.userId,
        set: {
          balance: sql`${schema.userCredits.balance} + ${credits}`,
          updatedAt: new Date(),
        },
      });

    await tx.insert(schema.creditLedger).values({
      userId,
      delta: credits,
      reason: 'PAYMENT',
      adminId: null,
    });
  });
}

// Shared by /v1/merchant/payments/verify and /v1/dev/payments/verify — both
// check the same "orderId|paymentId" HMAC construction against a caller-
// supplied signature. The webhook handler in payments.routes.ts is NOT this:
// it HMACs the raw request body with a different secret, so it stays separate.
export function verifyRazorpaySignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
}
