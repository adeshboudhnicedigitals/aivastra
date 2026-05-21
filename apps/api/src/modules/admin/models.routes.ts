import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count, and } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import {
  PresignModelFaceBody, ConfirmModelFaceBody, PatchModelFaceBody,
  PresignModelBackgroundBody, ConfirmModelBackgroundBody, PatchModelBackgroundBody,
  PresignModelPoseBody, ConfirmModelPoseBody, PatchModelPoseBody,
} from '@aivastra/types';
import { requireAdmin } from './guard';
import { AppError } from '../../lib/errors';

export async function adminAssetsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // ── Faces ─────────────────────────────────────────────────────────────────

  app.get('/admin/assets/faces', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.modelFaces);
    const tmplCounts = await app.db
      .select({ faceId: schema.subcategoryTemplates.faceId, cnt: count() })
      .from(schema.subcategoryTemplates)
      .groupBy(schema.subcategoryTemplates.faceId);
    const countMap = Object.fromEntries(tmplCounts.map((r) => [r.faceId, Number(r.cnt)]));
    return {
      items: rows.map((r) => ({ ...r, templateCount: countMap[r.id] ?? 0 })),
    };
  });

  app.post('/admin/assets/faces/presign', {
    preHandler: W,
    schema: { body: PresignModelFaceBody },
  }, async (req) => {
    const { contentType } = req.body as { contentType: string };
    const newId = randomUUID();
    const r2Key = keys.modelFace(newId);
    const thumbKey = keys.modelFaceThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/assets/faces/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelFaceBody },
  }, async (req) => {
    const { label, gender, r2Key, thumbnailKey, sortOrder } = req.body as {
      label: string; gender: string; r2Key: string; thumbnailKey: string; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelFaces)
      .values({ label, gender, r2Key, thumbnailKey, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/assets/faces/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelFaceBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await app.db
      .update(schema.modelFaces)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelFaces.id, id))
      .returning({ id: schema.modelFaces.id });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'face not found');
    return { ok: true };
  });

  app.delete('/admin/assets/faces/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [face] = await app.db.select().from(schema.modelFaces).where(eq(schema.modelFaces.id, id));
    if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');

    const jobRef = await app.db.select({ jobId: schema.jobInputs.jobId })
      .from(schema.jobInputs).where(eq(schema.jobInputs.faceId, id)).limit(1);
    if (jobRef.length > 0) throw new AppError('CONFLICT', 409, 'face is referenced by existing jobs');

    const tmplRef = await app.db.select({ id: schema.subcategoryTemplates.id })
      .from(schema.subcategoryTemplates).where(eq(schema.subcategoryTemplates.faceId, id)).limit(1);
    if (tmplRef.length > 0) throw new AppError('CONFLICT', 409, 'face is used in subcategory templates — delete templates first');

    await Promise.allSettled([
      app.storage.deleteObject(face.r2Key),
      app.storage.deleteObject(face.thumbnailKey),
    ]);
    await app.db.delete(schema.modelFaces).where(eq(schema.modelFaces.id, id));
    return { ok: true };
  });

  // ── Backgrounds (global) ──────────────────────────────────────────────────

  app.get('/admin/assets/backgrounds', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.modelBackgrounds);
    return { items: rows };
  });

  app.post('/admin/assets/backgrounds/presign', {
    preHandler: W,
    schema: { body: PresignModelBackgroundBody },
  }, async (req) => {
    const { contentType } = req.body as { contentType: string };
    const newId = randomUUID();
    const r2Key = keys.modelBackground(newId);
    const thumbKey = keys.modelBackgroundThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/assets/backgrounds/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelBackgroundBody },
  }, async (req) => {
    const { label, r2Key, thumbnailKey, sortOrder } = req.body as {
      label: string; r2Key: string; thumbnailKey: string; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label, r2Key, thumbnailKey, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/assets/backgrounds/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelBackgroundBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await app.db
      .update(schema.modelBackgrounds)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelBackgrounds.id, id))
      .returning({ id: schema.modelBackgrounds.id });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'background not found');
    return { ok: true };
  });

  app.delete('/admin/assets/backgrounds/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [bg] = await app.db.select().from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.id, id));
    if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');

    const jobRef = await app.db.select({ jobId: schema.jobInputs.jobId })
      .from(schema.jobInputs).where(eq(schema.jobInputs.backgroundId, id)).limit(1);
    if (jobRef.length > 0) throw new AppError('CONFLICT', 409, 'background is referenced by existing jobs');

    const tmplRef = await app.db.select({ id: schema.subcategoryTemplates.id })
      .from(schema.subcategoryTemplates).where(eq(schema.subcategoryTemplates.backgroundId, id)).limit(1);
    if (tmplRef.length > 0) throw new AppError('CONFLICT', 409, 'background is used in subcategory templates — delete templates first');

    await Promise.allSettled([
      app.storage.deleteObject(bg.r2Key),
      app.storage.deleteObject(bg.thumbnailKey),
    ]);
    await app.db.delete(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, id));
    return { ok: true };
  });

  // ── Poses (per subcategory) ───────────────────────────────────────────────

  app.get('/admin/assets/poses', {
    preHandler: W,
    schema: {
      querystring: z.object({
        subcategoryId: z.string().uuid(),
        faceId: z.string().uuid().optional(),
        backgroundId: z.string().uuid().optional(),
      }),
    },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId } = req.query as {
      subcategoryId: string; faceId?: string; backgroundId?: string;
    };
    const conditions = [eq(schema.modelPoses.subcategoryId, subcategoryId)];
    if (faceId) conditions.push(eq(schema.modelPoses.faceId, faceId));
    if (backgroundId) conditions.push(eq(schema.modelPoses.backgroundId, backgroundId));
    const rows = await app.db.select().from(schema.modelPoses).where(and(...conditions));
    return { items: rows };
  });

  app.post('/admin/assets/poses/presign', {
    preHandler: W,
    schema: { body: PresignModelPoseBody },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId, contentType } = req.body as {
      subcategoryId: string; faceId: string; backgroundId: string; contentType: string;
    };
    const [sub] = await app.db.select().from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, subcategoryId));
    if (!sub) throw new AppError('NOT_FOUND', 404, 'subcategory not found');
    const [face] = await app.db.select({ id: schema.modelFaces.id }).from(schema.modelFaces)
      .where(eq(schema.modelFaces.id, faceId));
    if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');
    const [bg] = await app.db.select({ id: schema.modelBackgrounds.id }).from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.id, backgroundId));
    if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');
    const newId = randomUUID();
    const r2Key = keys.modelPose(newId);
    const thumbKey = keys.modelPoseThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/assets/poses/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelPoseBody },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId, label, r2Key, thumbnailKey, showsLower, showsShoes, sortOrder } = req.body as {
      subcategoryId: string; faceId: string; backgroundId: string;
      label: string; r2Key: string; thumbnailKey: string;
      showsLower: boolean; showsShoes: boolean; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelPoses)
      .values({ subcategoryId, faceId, backgroundId, label, r2Key, thumbnailKey, showsLower, showsShoes, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/assets/poses/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelPoseBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await app.db
      .update(schema.modelPoses)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelPoses.id, id))
      .returning({ id: schema.modelPoses.id });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'pose not found');
    return { ok: true };
  });

  app.delete('/admin/assets/poses/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [pose] = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.id, id));
    if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');

    const jobRef = await app.db.select({ jobId: schema.jobInputs.jobId })
      .from(schema.jobInputs).where(eq(schema.jobInputs.poseId, id)).limit(1);
    if (jobRef.length > 0) throw new AppError('CONFLICT', 409, 'pose is referenced by existing jobs');

    await Promise.allSettled([
      app.storage.deleteObject(pose.r2Key),
      app.storage.deleteObject(pose.thumbnailKey),
    ]);
    await app.db.delete(schema.modelPoses).where(eq(schema.modelPoses.id, id));
    return { ok: true };
  });
}
