import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count } from 'drizzle-orm';
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

export async function adminModelsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // ── Faces ─────────────────────────────────────────────────────────────────

  app.get('/admin/models/faces', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.modelFaces);
    const bgCounts = await app.db
      .select({ faceId: schema.modelBackgrounds.faceId, cnt: count() })
      .from(schema.modelBackgrounds)
      .groupBy(schema.modelBackgrounds.faceId);
    const countMap = Object.fromEntries(bgCounts.map((r) => [r.faceId, Number(r.cnt)]));
    return {
      items: rows.map((r) => ({ ...r, backgroundCount: countMap[r.id] ?? 0 })),
    };
  });

  app.post('/admin/models/faces/presign', {
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

  app.post('/admin/models/faces/confirm', {
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

  app.patch('/admin/models/faces/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelFaceBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await app.db
      .update(schema.modelFaces)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelFaces.id, id));
    return { ok: true };
  });

  app.delete('/admin/models/faces/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [face] = await app.db.select().from(schema.modelFaces).where(eq(schema.modelFaces.id, id));
    if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');

    const bgs = await app.db.select().from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.faceId, id));

    // Collect all R2 keys before any mutations
    const r2Keys: string[] = [face.r2Key, face.thumbnailKey];
    for (const bg of bgs) {
      r2Keys.push(bg.r2Key, bg.thumbnailKey);
      const poses = await app.db.select().from(schema.modelPoses)
        .where(eq(schema.modelPoses.backgroundId, bg.id));
      for (const pose of poses) {
        r2Keys.push(pose.r2Key, pose.thumbnailKey);
      }
    }

    // Delete R2 objects best-effort (outside transaction — R2 has no rollback)
    await Promise.allSettled(r2Keys.map((k) => app.storage.deleteObject(k)));

    // Delete DB rows in a single transaction
    const bgIds = bgs.map((b) => b.id);
    await app.db.transaction(async (tx) => {
      if (bgIds.length > 0) {
        for (const bgId of bgIds) {
          await tx.delete(schema.modelPoses).where(eq(schema.modelPoses.backgroundId, bgId));
        }
        await tx.delete(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.faceId, id));
      }
      await tx.delete(schema.modelFaces).where(eq(schema.modelFaces.id, id));
    });

    return { ok: true };
  });

  // ── Backgrounds ───────────────────────────────────────────────────────────

  app.get('/admin/models/backgrounds', {
    preHandler: W,
    schema: { querystring: z.object({ faceId: z.string().uuid() }) },
  }, async (req) => {
    const { faceId } = req.query as { faceId: string };
    const rows = await app.db.select().from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.faceId, faceId));
    const poseCounts = await app.db
      .select({ backgroundId: schema.modelPoses.backgroundId, cnt: count() })
      .from(schema.modelPoses)
      .groupBy(schema.modelPoses.backgroundId);
    const countMap = Object.fromEntries(poseCounts.map((r) => [r.backgroundId, Number(r.cnt)]));
    return {
      items: rows.map((r) => ({ ...r, poseCount: countMap[r.id] ?? 0 })),
    };
  });

  app.post('/admin/models/backgrounds/presign', {
    preHandler: W,
    schema: { body: PresignModelBackgroundBody },
  }, async (req) => {
    const { faceId, contentType } = req.body as { faceId: string; contentType: string };
    const [face] = await app.db.select().from(schema.modelFaces).where(eq(schema.modelFaces.id, faceId));
    if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');
    const newId = randomUUID();
    const r2Key = keys.modelBackground(newId);
    const thumbKey = keys.modelBackgroundThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/models/backgrounds/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelBackgroundBody },
  }, async (req) => {
    const { faceId, label, r2Key, thumbnailKey, sortOrder } = req.body as {
      faceId: string; label: string; r2Key: string; thumbnailKey: string; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ faceId, label, r2Key, thumbnailKey, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/models/backgrounds/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelBackgroundBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await app.db
      .update(schema.modelBackgrounds)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelBackgrounds.id, id));
    return { ok: true };
  });

  app.delete('/admin/models/backgrounds/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [bg] = await app.db.select().from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.id, id));
    if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');

    const poses = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.backgroundId, id));

    // Collect all R2 keys before any mutations
    const r2Keys: string[] = [bg.r2Key, bg.thumbnailKey];
    for (const pose of poses) {
      r2Keys.push(pose.r2Key, pose.thumbnailKey);
    }

    // Delete R2 objects best-effort (outside transaction — R2 has no rollback)
    await Promise.allSettled(r2Keys.map((k) => app.storage.deleteObject(k)));

    // Delete DB rows in a single transaction
    await app.db.transaction(async (tx) => {
      await tx.delete(schema.modelPoses).where(eq(schema.modelPoses.backgroundId, id));
      await tx.delete(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, id));
    });

    return { ok: true };
  });

  // ── Poses ─────────────────────────────────────────────────────────────────

  app.get('/admin/models/poses', {
    preHandler: W,
    schema: { querystring: z.object({ backgroundId: z.string().uuid() }) },
  }, async (req) => {
    const { backgroundId } = req.query as { backgroundId: string };
    const rows = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.backgroundId, backgroundId));
    return { items: rows };
  });

  app.post('/admin/models/poses/presign', {
    preHandler: W,
    schema: { body: PresignModelPoseBody },
  }, async (req) => {
    const { backgroundId, contentType } = req.body as { backgroundId: string; contentType: string };
    const [bg] = await app.db.select().from(schema.modelBackgrounds)
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

  app.post('/admin/models/poses/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelPoseBody },
  }, async (req) => {
    const { backgroundId, label, r2Key, thumbnailKey, showsLower, showsShoes, sortOrder } = req.body as {
      backgroundId: string; label: string; r2Key: string; thumbnailKey: string;
      showsLower: boolean; showsShoes: boolean; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelPoses)
      .values({ backgroundId, label, r2Key, thumbnailKey, showsLower, showsShoes, sortOrder })
      .returning();
    return row;
  });

  app.patch('/admin/models/poses/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelPoseBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await app.db
      .update(schema.modelPoses)
      .set({ ...(req.body as object), updatedAt: new Date() })
      .where(eq(schema.modelPoses.id, id));
    return { ok: true };
  });

  app.delete('/admin/models/poses/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [pose] = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.id, id));
    if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
    await Promise.allSettled([
      app.storage.deleteObject(pose.r2Key),
      app.storage.deleteObject(pose.thumbnailKey),
    ]);
    await app.db.delete(schema.modelPoses).where(eq(schema.modelPoses.id, id));
    return { ok: true };
  });
}
