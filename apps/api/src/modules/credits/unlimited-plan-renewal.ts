// Applies a paid Razorpay renewal to an unlimited_plans row. Shared by the
// user-facing verify route (unlimited-plan-renewal.routes.ts) and the
// Razorpay webhook (modules/payments/routes.ts), which both need to reach
// the same idempotent "mark this charge paid, extend the plan" logic — the
// webhook is the only account of a payment that completed after the browser
// tab closed before /verify ran.
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApplyRenewalResult {
  /** false when razorpayOrderId doesn't match any unlimited-plan charge — caller should fall through to its own "order not found" handling. */
  handled: boolean;
  /** true only when this call was the one that actually extended the plan (idempotent — a race loses this but still returns handled: true). */
  applied: boolean;
}

/**
 * Marks the pending charge for `razorpayOrderId` paid and extends the plan
 * by the same number of days its current [startAt, endAt] window spans,
 * starting from now — a fresh cycle, not a pile-up of unused days, matching
 * what an admin would set for a routine renewal. Exactly the admin-set price
 * (no GST), per the "negotiated deal" framing the whole feature was built
 * under (see unlimited_plans.pricePaise's comment).
 */
export async function applyUnlimitedPlanRenewalPayment(
  app: FastifyInstance,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature?: string,
): Promise<ApplyRenewalResult> {
  const [charge] = await app.db
    .select()
    .from(schema.unlimitedPlanCharges)
    .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, razorpayOrderId));
  if (!charge) return { handled: false, applied: false };
  if (charge.status === 'paid') return { handled: true, applied: false };

  let applied = false;
  await app.db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.unlimitedPlanCharges)
      .set({
        status: 'paid',
        razorpayPaymentId,
        razorpaySignature: razorpaySignature ?? null,
        chargedAt: new Date(),
      })
      .where(
        and(
          eq(schema.unlimitedPlanCharges.id, charge.id),
          eq(schema.unlimitedPlanCharges.status, 'pending'),
        ),
      )
      .returning({ id: schema.unlimitedPlanCharges.id });
    if (updated.length === 0) return; // already applied by a concurrent verify/webhook call

    applied = true;

    const [plan] = await tx
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, charge.unlimitedPlanId))
      .for('update');
    if (!plan) return; // FK guarantees this row exists; guard anyway

    const durationDays = Math.max(
      1,
      Math.round((plan.endAt.getTime() - plan.startAt.getTime()) / DAY_MS),
    );
    const now = new Date();
    const newEndAt = new Date(now.getTime() + durationDays * DAY_MS);

    await tx
      .update(schema.unlimitedPlans)
      .set({
        startAt: now,
        endAt: newEndAt,
        status: 'active',
        lastReminderStage: 'none',
        updatedAt: now,
      })
      .where(eq(schema.unlimitedPlans.id, plan.id));
  });

  return { handled: true, applied };
}

/** Marks a still-pending charge failed — mirrors payments.status on a Razorpay payment.failed webhook. No-ops if the charge is already resolved or doesn't exist. */
export async function markUnlimitedPlanChargeFailed(
  app: FastifyInstance,
  razorpayOrderId: string,
): Promise<void> {
  await app.db
    .update(schema.unlimitedPlanCharges)
    .set({ status: 'failed' })
    .where(
      and(
        eq(schema.unlimitedPlanCharges.razorpayOrderId, razorpayOrderId),
        eq(schema.unlimitedPlanCharges.status, 'pending'),
      ),
    );
}
