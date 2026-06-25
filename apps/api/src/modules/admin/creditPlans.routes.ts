import { schema } from '@aivastra/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

const PlanBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, hyphens only'),
  name: z.string().min(1).max(100),
  subtext: z.string().max(200).default(''),
  credits: z.number().int().positive(),
  basePaise: z.number().int().positive(),
  isActive: z.boolean().default(true),
  isHighlighted: z.boolean().default(false),
  badge: z.string().max(50).nullable().default(null),
  sortOrder: z.number().int().default(0),
  queueStream: z.enum(['priority', 'normal', 'low']).default('normal'),
});

export async function adminCreditPlansRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN']);

  app.get('/admin/credit-plans', { preHandler: W }, async () => {
    return app.db.select().from(schema.creditPlans).orderBy(asc(schema.creditPlans.sortOrder));
  });

  app.post('/admin/credit-plans', { preHandler: W, schema: { body: PlanBody } }, async (req) => {
    const body = req.body as z.infer<typeof PlanBody>;
    const [plan] = await app.db.insert(schema.creditPlans).values(body).returning();
    return plan;
  });

  app.patch(
    '/admin/credit-plans/:id',
    {
      preHandler: W,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PlanBody.partial(),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<z.infer<typeof PlanBody>>;
      const [plan] = await app.db
        .update(schema.creditPlans)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.creditPlans.id, id))
        .returning();
      if (!plan) throw new AppError('NOT_FOUND', 404, 'plan not found');
      return plan;
    },
  );

  app.delete(
    '/admin/credit-plans/:id',
    {
      preHandler: W,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [plan] = await app.db
        .select({ slug: schema.creditPlans.slug })
        .from(schema.creditPlans)
        .where(eq(schema.creditPlans.id, id));
      if (!plan) throw new AppError('NOT_FOUND', 404, 'plan not found');

      const [payment] = await app.db
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(eq(schema.payments.planId, plan.slug))
        .limit(1);
      if (payment) {
        throw new AppError(
          'CONFLICT',
          409,
          'plan has existing payments; deactivate instead of deleting',
        );
      }

      await app.db.delete(schema.creditPlans).where(eq(schema.creditPlans.id, id));
      reply.code(204).send();
    },
  );
}
