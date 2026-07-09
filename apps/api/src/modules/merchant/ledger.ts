import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export async function atomicMerchantDeduct(
  db: DB,
  merchantId: string,
  amount: number,
  jobId: string,
) {
  const balance = await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.merchantCredits)
      .set({
        balance: sql`${schema.merchantCredits.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.merchantCredits.merchantId, merchantId),
          gte(schema.merchantCredits.balance, amount),
        ),
      )
      .returning({ balance: schema.merchantCredits.balance });
    if (!res.length) throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
    await tx.insert(schema.merchantCreditLedger).values({
      merchantId,
      delta: -amount,
      reason: 'JOB_DISPATCH',
      jobId,
    });
    return res[0]?.balance;
  });
  return balance;
}

export async function merchantRefund(
  db: DB,
  merchantId: string,
  amount: number,
  jobId: string,
  reason = 'REFUND',
) {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.merchantCreditLedger)
      .where(
        and(
          eq(schema.merchantCreditLedger.jobId, jobId),
          eq(schema.merchantCreditLedger.reason, reason),
        ),
      );
    if (existing.length) return;
    await tx
      .update(schema.merchantCredits)
      .set({
        balance: sql`${schema.merchantCredits.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.merchantCredits.merchantId, merchantId));
    await tx
      .insert(schema.merchantCreditLedger)
      .values({ merchantId, delta: amount, reason, jobId });
  });
}

export async function merchantAdminGrant(
  db: DB,
  merchantId: string,
  amount: number,
  reason: string,
  adminId: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.merchantCredits)
      .values({ merchantId, balance: amount })
      .onConflictDoUpdate({
        target: schema.merchantCredits.merchantId,
        set: {
          balance: sql`${schema.merchantCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(schema.merchantCreditLedger)
      .values({ merchantId, delta: amount, reason, adminId });
  });
}
