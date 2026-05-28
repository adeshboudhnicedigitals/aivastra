import { schema } from '@aivastra/db';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function creditsRoutes(app: FastifyInstance) {
  app.get('/v1/credits', { preHandler: app.requireUser }, async (req) => {
    const [bal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, req.userId));
    const recent = await app.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, req.userId))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(20);
    return {
      balance: bal?.balance ?? 0,
      recent: recent.map((r) => ({
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post(
    '/v1/credits/request',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          creditsRequested: z.number().int().min(1).max(10000),
          note: z.string().max(500).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { creditsRequested, note } = req.body as { creditsRequested: number; note?: string };
      const [inserted] = await app.db
        .insert(schema.creditRequests)
        .values({
          userId: req.userId,
          creditsRequested,
          note: note ?? null,
        })
        .returning({ id: schema.creditRequests.id });
      return reply.code(201).send({ id: inserted!.id });
    },
  );

  app.get('/v1/credits/requests', { preHandler: app.requireUser }, async (req) => {
    const items = await app.db
      .select()
      .from(schema.creditRequests)
      .where(eq(schema.creditRequests.userId, req.userId))
      .orderBy(desc(schema.creditRequests.createdAt));
    return {
      items: items.map((r) => ({
        id: r.id,
        creditsRequested: r.creditsRequested,
        creditsApproved: r.creditsApproved,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
