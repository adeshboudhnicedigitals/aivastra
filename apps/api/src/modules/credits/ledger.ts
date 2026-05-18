import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { eq, sql, and, gte } from 'drizzle-orm';
import { AppError } from '../../lib/errors';

export async function atomicDeduct(db: DB, userId: string, amount: number, jobId: string) {
  return db.transaction(async (tx) => {
    const res = await tx.update(schema.userCredits)
      .set({ balance: sql`${schema.userCredits.balance} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(schema.userCredits.userId, userId), gte(schema.userCredits.balance, amount)))
      .returning({ balance: schema.userCredits.balance });
    if (!res.length) throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
    await tx.insert(schema.creditLedger).values({ userId, delta: -amount, reason: 'JOB_DISPATCH', jobId });
    return res[0]!.balance;
  });
}

export async function refund(db: DB, userId: string, amount: number, jobId: string, reason = 'REFUND') {
  await db.transaction(async (tx) => {
    // idempotent: skip if matching refund already logged for this jobId
    const existing = await tx.select().from(schema.creditLedger)
      .where(and(eq(schema.creditLedger.jobId, jobId), eq(schema.creditLedger.reason, reason)));
    if (existing.length) return;
    await tx.update(schema.userCredits)
      .set({ balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() })
      .where(eq(schema.userCredits.userId, userId));
    await tx.insert(schema.creditLedger).values({ userId, delta: amount, reason, jobId });
  });
}

export async function adminGrant(db: DB, userId: string, amount: number, reason: string, adminId: string) {
  await db.transaction(async (tx) => {
    await tx.insert(schema.userCredits).values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId,
        set: { balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() } });
    await tx.insert(schema.creditLedger).values({ userId, delta: amount, reason, adminId });
  });
}
