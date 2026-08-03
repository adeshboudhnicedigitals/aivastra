import { schema } from '@aivastra/db';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Mirrors the eligibility check in grantPurchaseCredits (apps/api/src/modules/payments/routes.ts):
// a campaign-attributed user who hasn't made a paid purchase yet. Doesn't gate on the
// campaign's isActive/date window since the actual grant doesn't either — attribution
// is permanent from signup, so this must report exactly what purchasing will actually do.
async function firstPurchaseBonusPercent(
  app: FastifyInstance,
  userId: string,
): Promise<number | null> {
  const [user] = await app.db
    .select({ campaignId: schema.users.signupCampaignId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user?.campaignId) return null;

  const [priorPaid] = await app.db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(and(eq(schema.payments.userId, userId), eq(schema.payments.status, 'paid')))
    .limit(1);
  if (priorPaid) return null;

  const [campaign] = await app.db
    .select({ bonusPercent: schema.signupCampaigns.bonusPercent })
    .from(schema.signupCampaigns)
    .where(eq(schema.signupCampaigns.id, user.campaignId));
  return campaign?.bonusPercent ?? null;
}

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
      firstPurchaseBonusPercent: await firstPurchaseBonusPercent(app, req.userId),
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
      return reply.code(201).send({ id: inserted?.id });
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
