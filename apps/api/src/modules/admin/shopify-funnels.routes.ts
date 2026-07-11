import { schema } from '@aivastra/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

const CreateFunnelTemplateBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  label: z.string().min(1).max(120),
  workflowTemplateId: z.string().uuid(),
  sortOrder: z.number().int().default(0),
});

const PatchFunnelTemplateBody = z.object({
  label: z.string().min(1).max(120).optional(),
  workflowTemplateId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function adminShopifyFunnelsRoutes(app: FastifyInstance) {
  const RW = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/shopify/funnel-templates', { preHandler: RW }, async () => {
    const items = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));
    return { items };
  });

  app.post(
    '/admin/shopify/funnel-templates',
    { preHandler: RW, schema: { body: CreateFunnelTemplateBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateFunnelTemplateBody>;
      const [row] = await app.db.insert(schema.shopifyFunnelTemplates).values(body).returning();
      return row;
    },
  );

  app.patch(
    '/admin/shopify/funnel-templates/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchFunnelTemplateBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchFunnelTemplateBody>;
      const [updated] = await app.db
        .update(schema.shopifyFunnelTemplates)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.shopifyFunnelTemplates.id, id))
        .returning({ id: schema.shopifyFunnelTemplates.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
      return { ok: true };
    },
  );
}
