import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, sql, sum, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { GrantCreditsBody, BulkGrantBody, DeductCreditsBody } from '@aivastra/types';
import { adminGrant } from '../credits/ledger.js';
import { requireAdmin } from './guard.js';
import { AppError } from '../../lib/errors.js';

export async function adminCreditsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.post('/admin/credits/grant', { preHandler: W, schema: { body: GrantCreditsBody } }, async (req) => {
    const { userId, amount, reason } = req.body as any;
    await adminGrant(app.db, userId, amount, reason, req.userId);
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

  // Credit request management
  app.get('/admin/credits/requests', {
    preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR']),
    schema: { querystring: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }) },
  }, async (req) => {
    const { status } = req.query as { status?: string };
    const items = await app.db
      .select({
        id: schema.creditRequests.id,
        userId: schema.creditRequests.userId,
        creditsRequested: schema.creditRequests.creditsRequested,
        creditsApproved: schema.creditRequests.creditsApproved,
        note: schema.creditRequests.note,
        status: schema.creditRequests.status,
        createdAt: schema.creditRequests.createdAt,
        userEmail: schema.users.email,
      })
      .from(schema.creditRequests)
      .leftJoin(schema.users, eq(schema.users.id, schema.creditRequests.userId))
      .where(status ? eq(schema.creditRequests.status, status) : undefined)
      .orderBy(desc(schema.creditRequests.createdAt));
    return { items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });

  app.patch('/admin/credits/requests/:id/approve', {
    preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ creditsApproved: z.number().int().min(1), adminNote: z.string().optional() }),
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { creditsApproved, adminNote } = req.body as { creditsApproved: number; adminNote?: string };
    const [request] = await app.db.select().from(schema.creditRequests).where(eq(schema.creditRequests.id, id));
    if (!request) throw new AppError('NOT_FOUND', 404, 'request not found');
    if (request.status !== 'pending') throw new AppError('CONFLICT', 409, 'request already reviewed');

    await app.db.transaction(async (tx) => {
      await tx.update(schema.creditRequests).set({
        status: 'approved',
        creditsApproved,
        adminNote: adminNote ?? null,
        reviewedAt: new Date(),
        reviewedBy: req.userId,
      }).where(eq(schema.creditRequests.id, id));
      // Inline grant (avoids nested transaction)
      await tx.insert(schema.userCredits).values({ userId: request.userId, balance: creditsApproved })
        .onConflictDoUpdate({
          target: schema.userCredits.userId,
          set: { balance: sql`${schema.userCredits.balance} + ${creditsApproved}`, updatedAt: new Date() },
        });
      await tx.insert(schema.creditLedger).values({
        userId: request.userId,
        delta: creditsApproved,
        reason: `CREDIT_REQUEST_APPROVED:${id}`,
        adminId: req.userId,
      });
    });
    return { ok: true };
  });

  app.patch('/admin/credits/requests/:id/reject', {
    preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ adminNote: z.string().optional() }),
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { adminNote } = req.body as { adminNote?: string };
    const [request] = await app.db.select().from(schema.creditRequests).where(eq(schema.creditRequests.id, id));
    if (!request) throw new AppError('NOT_FOUND', 404, 'request not found');
    if (request.status !== 'pending') throw new AppError('CONFLICT', 409, 'request already reviewed');
    await app.db.update(schema.creditRequests).set({
      status: 'rejected',
      adminNote: adminNote ?? null,
      reviewedAt: new Date(),
      reviewedBy: req.userId,
    }).where(eq(schema.creditRequests.id, id));
    return { ok: true };
  });
}
