import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, sql, sum, desc } from 'drizzle-orm';
import { z } from 'zod';
import { GrantCreditsBody, BulkGrantBody, DeductCreditsBody } from '@aivastra/types';
import { adminGrant } from '../credits/ledger.js';
import { requireAdmin } from './guard.js';
import { AppError } from '../../lib/errors.js';

export async function adminCreditsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.post('/admin/credits/grant', { preHandler: W, schema: { body: GrantCreditsBody } }, async (req) => {
    const { userId, amount, reason } = req.body as any;
    await adminGrant(app.db, userId, amount, reason || 'Manual credit grant', req.userId);
    return { ok: true };
  });

  app.post('/admin/credits/bulk-grant', { preHandler: W, schema: { body: BulkGrantBody } }, async (req) => {
    const { tier, amount, reason } = req.body as any;
    const targets = await app.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.tier, tier));
    for (const t of targets) await adminGrant(app.db, t.id, amount, reason, req.userId);
    return { ok: true, count: targets.length };
  });

  app.post('/admin/credits/deduct', { preHandler: W, schema: { body: DeductCreditsBody } }, async (req) => {
    const { userId, amount, reason } = req.body as any;
    await app.db.transaction(async (tx) => {
      const res = await tx.update(schema.userCredits)
        .set({ balance: sql`${schema.userCredits.balance} - ${amount}`, updatedAt: new Date() })
        .where(sql`${schema.userCredits.userId}=${userId} AND ${schema.userCredits.balance} >= ${amount}`)
        .returning();
      if (!res.length) throw new AppError('INSUFFICIENT', 409, 'cannot deduct below zero');
      await tx.insert(schema.creditLedger).values({ userId, delta: -amount, reason, adminId: req.userId });
    });
    return { ok: true };
  });

  app.get('/admin/credits/ledger/:userId', {
    preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']),
    schema: { params: z.object({ userId: z.string().uuid() }) },
  }, async (req) => {
    const { userId } = req.params as any;
    return app.db.select().from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId))
      .orderBy(desc(schema.creditLedger.createdAt)).limit(200);
  });

  app.get('/admin/credits/stats', {
    preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']),
  }, async () => {
    const [issued] = await app.db.select({ s: sum(schema.creditLedger.delta) })
      .from(schema.creditLedger).where(sql`${schema.creditLedger.delta} > 0`);
    const [consumed] = await app.db.select({ s: sum(schema.creditLedger.delta) })
      .from(schema.creditLedger).where(sql`${schema.creditLedger.delta} < 0`);
    return { issued: Number(issued?.s ?? 0), consumed: Number(consumed?.s ?? 0) };
  });
}
