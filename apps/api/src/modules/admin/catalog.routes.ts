import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, and, count } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import {
  PresignCatalogItemBody, ConfirmCatalogItemBody, CreateCategoryBody,
} from '@aivastra/types';
import { requireAdmin } from './guard';
import { AppError } from '../../lib/errors';

export async function adminCatalogRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.get('/admin/catalog/items', { preHandler: W }, async () =>
    app.db.select().from(schema.catalogItems));

  app.post('/admin/catalog/items/presign', { preHandler: W, schema: { body: PresignCatalogItemBody } },
    async (req) => {
      const { contentType, categoryId } = req.body as any;
      const [cat] = await app.db.select().from(schema.catalogCategories)
        .where(eq(schema.catalogCategories.id, categoryId));
      if (!cat) throw new AppError('NOT_FOUND', 404, 'category not found');
      const [type] = await app.db.select().from(schema.catalogTypes)
        .where(eq(schema.catalogTypes.id, cat.typeId));
      const newId = randomUUID();
      const r2Key = keys.catalogItem(type!.slug, newId);
      const thumbKey = keys.catalogThumb(type!.slug, newId);
      const main = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      const thumb = await app.storage.presignPut(thumbKey, contentType, 1_000_000, 300);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
    });

  app.post('/admin/catalog/items/confirm', { preHandler: W, schema: { body: ConfirmCatalogItemBody } },
    async (req) => {
      const { categoryId, label, r2Key, thumbnailKey, sortOrder } = req.body as any;
      const [row] = await app.db.insert(schema.catalogItems)
        .values({ categoryId, label, r2Key, thumbnailKey, sortOrder }).returning();
      return row;
    });

  app.patch('/admin/catalog/items/:id', {
    preHandler: W,
    schema: { params: z.object({ id: z.string().uuid() }),
      body: z.object({
        label: z.string().max(120).optional(), isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(), categoryId: z.number().int().optional(),
      }) },
  }, async (req) => {
    const { id } = req.params as any;
    await app.db.update(schema.catalogItems).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.catalogItems.id, id));
    return { ok: true };
  });

  app.delete('/admin/catalog/items/:id', {
    preHandler: W, schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as any;
    const [item] = await app.db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id));
    if (!item) throw new AppError('NOT_FOUND', 404, 'item not found');
    await app.storage.deleteObject(item.r2Key);
    await app.storage.deleteObject(item.thumbnailKey);
    await app.db.delete(schema.catalogItems).where(eq(schema.catalogItems.id, id));
    return { ok: true };
  });

  app.post('/admin/catalog/categories', { preHandler: W, schema: { body: CreateCategoryBody } }, async (req) => {
    const [row] = await app.db.insert(schema.catalogCategories).values(req.body as any).returning();
    return row;
  });

  app.delete('/admin/catalog/categories/:id', {
    preHandler: W, schema: { params: z.object({ id: z.coerce.number().int() }) },
  }, async (req) => {
    const { id } = req.params as any;
    const [{ value }] = await app.db.select({ value: count() }).from(schema.catalogItems)
      .where(and(eq(schema.catalogItems.categoryId, id), eq(schema.catalogItems.isActive, true)));
    if (value > 0) throw new AppError('IN_USE', 409, 'category has active items');
    await app.db.delete(schema.catalogCategories).where(eq(schema.catalogCategories.id, id));
    return { ok: true };
  });
}
