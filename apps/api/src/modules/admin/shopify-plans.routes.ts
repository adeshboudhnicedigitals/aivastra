import { schema } from '@aivastra/db';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './guard.js';

const CreatePlan = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  includedTryons: z.number().int().positive(),
  overageCents: z.number().int().nonnegative(),
  trialDays: z.number().int().nonnegative().default(7),
  sortOrder: z.number().int().default(0),
});
const UpdatePlan = CreatePlan.partial().extend({ isActive: z.boolean().optional() });

export async function adminShopifyPlansRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'ADMIN']);

  app.get('/admin/shopify-plans', { preHandler: W }, async (req) => {
    const activeOnly = (req.query as { activeOnly?: string }).activeOnly === 'true';
    const rows = await app.db
      .select()
      .from(schema.shopifyPlans)
      .orderBy(desc(schema.shopifyPlans.sortOrder));
    return { plans: activeOnly ? rows.filter((r) => r.isActive) : rows };
  });

  app.post(
    '/admin/shopify-plans',
    { preHandler: W, schema: { body: CreatePlan } },
    async (req, reply) => {
      const [plan] = await app.db
        .insert(schema.shopifyPlans)
        .values(req.body as z.infer<typeof CreatePlan>)
        .returning();
      return reply.code(201).send({ id: plan.id, plan });
    },
  );

  app.patch(
    '/admin/shopify-plans/:id',
    { preHandler: W, schema: { body: UpdatePlan } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [plan] = await app.db
        .update(schema.shopifyPlans)
        .set(req.body as z.infer<typeof UpdatePlan>)
        .where(eq(schema.shopifyPlans.id, id))
        .returning();
      return { plan };
    },
  );

  app.delete('/admin/shopify-plans/:id', { preHandler: W }, async (req) => {
    const { id } = req.params as { id: string };
    await app.db
      .update(schema.shopifyPlans)
      .set({ isActive: false })
      .where(eq(schema.shopifyPlans.id, id));
    return { ok: true };
  });
}
