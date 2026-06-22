import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export async function atomicWidgetDeduct(
  db: DB,
  widgetClientId: string,
  amount: number,
  jobId: string,
) {
  const balance = await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.widgetClientCredits)
      .set({
        balance: sql`${schema.widgetClientCredits.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.widgetClientCredits.widgetClientId, widgetClientId),
          gte(schema.widgetClientCredits.balance, amount),
        ),
      )
      .returning({ balance: schema.widgetClientCredits.balance });
    if (!res.length) throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
    await tx.insert(schema.widgetCreditLedger).values({
      widgetClientId,
      delta: -amount,
      reason: 'JOB_DISPATCH',
      jobId,
    });
    return res[0]?.balance;
  });
  return balance;
}

export async function widgetRefund(
  db: DB,
  widgetClientId: string,
  amount: number,
  jobId: string,
  reason = 'REFUND',
) {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.widgetCreditLedger)
      .where(
        and(
          eq(schema.widgetCreditLedger.jobId, jobId),
          eq(schema.widgetCreditLedger.reason, reason),
        ),
      );
    if (existing.length) return;
    await tx
      .update(schema.widgetClientCredits)
      .set({
        balance: sql`${schema.widgetClientCredits.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.widgetClientCredits.widgetClientId, widgetClientId));
    await tx
      .insert(schema.widgetCreditLedger)
      .values({ widgetClientId, delta: amount, reason, jobId });
  });
}

export async function widgetAdminGrant(
  db: DB,
  widgetClientId: string,
  amount: number,
  reason: string,
  adminId: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.widgetClientCredits)
      .values({ widgetClientId, balance: amount })
      .onConflictDoUpdate({
        target: schema.widgetClientCredits.widgetClientId,
        set: {
          balance: sql`${schema.widgetClientCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(schema.widgetCreditLedger)
      .values({ widgetClientId, delta: amount, reason, adminId });
  });
}
