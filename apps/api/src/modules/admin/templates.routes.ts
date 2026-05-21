import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import {
  PresignSubcategoryTemplateBody,
  ConfirmSubcategoryTemplateBody,
  PatchSubcategoryTemplateBody,
} from '@aivastra/types';
import { requireAdmin } from './guard';
import { AppError } from '../../lib/errors';

export async function adminTemplatesRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/templates', {
    preHandler: W,
    schema: { querystring: z.object({ subcategoryId: z.string().uuid() }) },
  }, async (req) => {
    const { subcategoryId } = req.query as { subcategoryId: string };
    const rows = await app.db.select({
      id: schema.subcategoryTemplates.id,
      subcategoryId: schema.subcategoryTemplates.subcategoryId,
      faceId: schema.subcategoryTemplates.faceId,
      backgroundId: schema.subcategoryTemplates.backgroundId,
      r2Key: schema.subcategoryTemplates.r2Key,
      thumbnailKey: schema.subcategoryTemplates.thumbnailKey,
      isActive: schema.subcategoryTemplates.isActive,
      sortOrder: schema.subcategoryTemplates.sortOrder,
      createdAt: schema.subcategoryTemplates.createdAt,
      updatedAt: schema.subcategoryTemplates.updatedAt,
      faceLabel: schema.modelFaces.label,
      backgroundLabel: schema.modelBackgrounds.label,
    })
      .from(schema.subcategoryTemplates)
      .leftJoin(schema.modelFaces, eq(schema.subcategoryTemplates.faceId, schema.modelFaces.id))
      .leftJoin(schema.modelBackgrounds, eq(schema.subcategoryTemplates.backgroundId, schema.modelBackgrounds.id))
      .where(eq(schema.subcategoryTemplates.subcategoryId, subcategoryId));
    return { items: rows };
  });

  app.post('/admin/assets/templates/presign', {
    preHandler: W,
    schema: { body: PresignSubcategoryTemplateBody },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId, contentType } = req.body as {
      subcategoryId: string; faceId: string; backgroundId: string; contentType: string;
    };
    const [sub] = await app.db.select().from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, subcategoryId));
    if (!sub) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

    const [face] = await app.db.select({ id: schema.modelFaces.id })
      .from(schema.modelFaces).where(eq(schema.modelFaces.id, faceId));
    if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');

    const [bg] = await app.db.select({ id: schema.modelBackgrounds.id })
      .from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, backgroundId));
    if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');

    const newId = randomUUID();
    const r2Key = keys.subcategoryTemplate(newId);
    const thumbKey = keys.subcategoryTemplateThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/assets/templates/confirm', {
    preHandler: W,
    schema: { body: ConfirmSubcategoryTemplateBody },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId, r2Key, thumbnailKey, sortOrder } = req.body as {
      subcategoryId: string; faceId: string; backgroundId: string;
      r2Key: string; thumbnailKey: string; sortOrder: number;
    };
    try {
      const [row] = await app.db
        .insert(schema.subcategoryTemplates)
        .values({ subcategoryId, faceId, backgroundId, r2Key, thumbnailKey, sortOrder })
        .returning();
      return row;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('subcategory_templates_lookup_idx') || msg.includes('unique') || msg.includes('duplicate')) {
        throw new AppError('CONFLICT', 409, 'template for this face+background combination already exists');
      }
      throw err;
    }
  });

  app.patch('/admin/assets/templates/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchSubcategoryTemplateBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await app.db
      .update(schema.subcategoryTemplates)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.subcategoryTemplates.id, id))
      .returning({ id: schema.subcategoryTemplates.id });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'template not found');
    return { ok: true };
  });

  app.delete('/admin/assets/templates/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [tmpl] = await app.db.select().from(schema.subcategoryTemplates)
      .where(eq(schema.subcategoryTemplates.id, id));
    if (!tmpl) throw new AppError('NOT_FOUND', 404, 'template not found');

    await Promise.allSettled([
      app.storage.deleteObject(tmpl.r2Key),
      app.storage.deleteObject(tmpl.thumbnailKey),
    ]);
    await app.db.delete(schema.subcategoryTemplates)
      .where(eq(schema.subcategoryTemplates.id, id));
    return { ok: true };
  });
}
