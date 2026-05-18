import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, desc } from 'drizzle-orm';

export async function creditsRoutes(app: FastifyInstance) {
  app.get('/v1/credits', { preHandler: app.requireUser }, async (req) => {
    const [bal] = await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, req.userId));
    const recent = await app.db.select().from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, req.userId))
      .orderBy(desc(schema.creditLedger.createdAt)).limit(20);
    return {
      balance: bal?.balance ?? 0,
      recent: recent.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, createdAt: r.createdAt.toISOString() })),
    };
  });
}
