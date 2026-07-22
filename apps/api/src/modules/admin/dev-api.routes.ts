import { schema } from '@aivastra/db';
import {
  CreateDevTryonCategoryBody,
  UpdateDevSareeConfigBody,
  UpdateDevTryonCategoryBody,
} from '@aivastra/types';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

const DEV_SAREE_CONFIG_ID = '00000000-0000-0000-0000-000000000002';

export async function adminDevApiRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const R = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/dev-api/tryon-categories', { preHandler: R }, async () => {
    return app.db
      .select()
      .from(schema.devTryonCategories)
      .orderBy(asc(schema.devTryonCategories.sortOrder));
  });

  app.post(
    '/admin/dev-api/tryon-categories',
    { preHandler: W, schema: { body: CreateDevTryonCategoryBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateDevTryonCategoryBody>;
      try {
        const [row] = await app.db
          .insert(schema.devTryonCategories)
          .values({
            name: body.name,
            slug: body.slug,
            workflowTemplateId: body.workflowTemplateId ?? null,
            sortOrder: body.sortOrder ?? 0,
            isActive: body.isActive ?? true,
          })
          .returning();
        return row;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError('CONFLICT', 409, `slug "${body.slug}" already exists`);
        }
        throw err;
      }
    },
  );

  app.patch(
    '/admin/dev-api/tryon-categories/:id',
    { preHandler: W, schema: { params: uuidParam, body: UpdateDevTryonCategoryBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof UpdateDevTryonCategoryBody>;
      const [row] = await app.db
        .update(schema.devTryonCategories)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.workflowTemplateId !== undefined
            ? { workflowTemplateId: body.workflowTemplateId }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.devTryonCategories.id, id))
        .returning();
      if (!row) throw new AppError('NOT_FOUND', 404, 'category not found');
      return row;
    },
  );

  app.delete(
    '/admin/dev-api/tryon-categories/:id',
    { preHandler: W, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const deleted = await app.db
        .delete(schema.devTryonCategories)
        .where(eq(schema.devTryonCategories.id, id))
        .returning({ id: schema.devTryonCategories.id });
      if (!deleted.length) throw new AppError('NOT_FOUND', 404, 'category not found');
      return { ok: true };
    },
  );

  app.get('/admin/dev-api/saree-config', { preHandler: R }, async () => {
    const [row] = await app.db
      .select({
        workflowTemplateId: schema.devSareeMannequinConfig.workflowTemplateId,
        isActive: schema.devSareeMannequinConfig.isActive,
        updatedAt: schema.devSareeMannequinConfig.updatedAt,
      })
      .from(schema.devSareeMannequinConfig)
      .where(eq(schema.devSareeMannequinConfig.id, DEV_SAREE_CONFIG_ID));
    return row ?? { workflowTemplateId: null, isActive: false, updatedAt: null };
  });

  app.patch(
    '/admin/dev-api/saree-config',
    { preHandler: W, schema: { body: UpdateDevSareeConfigBody } },
    async (req) => {
      const body = req.body as z.infer<typeof UpdateDevSareeConfigBody>;
      const [row] = await app.db
        .insert(schema.devSareeMannequinConfig)
        .values({
          id: DEV_SAREE_CONFIG_ID,
          workflowTemplateId: body.workflowTemplateId ?? null,
          isActive: body.isActive ?? true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.devSareeMannequinConfig.id,
          set: {
            ...(body.workflowTemplateId !== undefined
              ? { workflowTemplateId: body.workflowTemplateId }
              : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            updatedAt: new Date(),
          },
        })
        .returning({
          workflowTemplateId: schema.devSareeMannequinConfig.workflowTemplateId,
          isActive: schema.devSareeMannequinConfig.isActive,
          updatedAt: schema.devSareeMannequinConfig.updatedAt,
        });
      return row;
    },
  );
}
