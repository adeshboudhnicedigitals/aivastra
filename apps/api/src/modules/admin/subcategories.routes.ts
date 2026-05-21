import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CreateGarmentSubcategoryBody, PatchGarmentSubcategoryBody } from '@aivastra/types';
import { requireAdmin } from './guard';
import { AppError } from '../../lib/errors';

export async function adminSubcategoriesRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/subcategories', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.garmentSubcategories);
    const poseCounts = await app.db
      .select({ subcategoryId: schema.modelPoses.subcategoryId, cnt: count() })
      .from(schema.modelPoses)
      .groupBy(schema.modelPoses.subcategoryId);
    const tmplCounts = await app.db
      .select({ subcategoryId: schema.subcategoryTemplates.subcategoryId, cnt: count() })
      .from(schema.subcategoryTemplates)
      .groupBy(schema.subcategoryTemplates.subcategoryId);
    const poseMap = Object.fromEntries(poseCounts.map((r) => [r.subcategoryId, Number(r.cnt)]));
    const tmplMap = Object.fromEntries(tmplCounts.map((r) => [r.subcategoryId, Number(r.cnt)]));
    return {
      items: rows.map((r) => ({
        ...r,
        poseCount: poseMap[r.id] ?? 0,
        templateCount: tmplMap[r.id] ?? 0,
      })),
    };
  });

  app.post('/admin/assets/subcategories', {
    preHandler: W,
    schema: { body: CreateGarmentSubcategoryBody },
  }, async (req) => {
    const { genderSlug, slug, label, sortOrder } = req.body as {
      genderSlug: string; slug: string; label: string; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug, slug, label, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/assets/subcategories/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchGarmentSubcategoryBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await app.db
      .update(schema.garmentSubcategories)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.garmentSubcategories.id, id))
      .returning({ id: schema.garmentSubcategories.id });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'subcategory not found');
    return { ok: true };
  });

  app.delete('/admin/assets/subcategories/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [sub] = await app.db.select().from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, id));
    if (!sub) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

    const poses = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.subcategoryId, id));
    const poseJobRefs = poses.length > 0
      ? await app.db.select({ jobId: schema.jobInputs.jobId })
          .from(schema.jobInputs)
          .where(inArray(schema.jobInputs.poseId, poses.map((p) => p.id)))
          .limit(1)
      : [];
    if (poseJobRefs.length > 0) throw new AppError('CONFLICT', 409, 'subcategory has poses referenced by existing jobs');

    const templates = await app.db.select().from(schema.subcategoryTemplates)
      .where(eq(schema.subcategoryTemplates.subcategoryId, id));

    const r2Keys = [
      ...poses.flatMap((p) => [p.r2Key, p.thumbnailKey]),
      ...templates.flatMap((t) => [t.r2Key, t.thumbnailKey]),
    ];
    await Promise.allSettled(r2Keys.map((k) => app.storage.deleteObject(k)));

    await app.db.transaction(async (tx) => {
      if (templates.length > 0) {
        await tx.delete(schema.subcategoryTemplates)
          .where(eq(schema.subcategoryTemplates.subcategoryId, id));
      }
      if (poses.length > 0) {
        await tx.delete(schema.modelPoses)
          .where(eq(schema.modelPoses.subcategoryId, id));
      }
      await tx.delete(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
    });

    return { ok: true };
  });
}
