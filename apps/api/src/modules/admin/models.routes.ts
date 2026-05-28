import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count, and, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import {
  PresignModelFaceBody, ConfirmModelFaceBody, PatchModelFaceBody,
  PresignModelBackgroundBody, ConfirmModelBackgroundBody, PatchModelBackgroundBody,
  PresignModelPoseBody, ConfirmModelPoseBody, PatchModelPoseBody,
  AssetContentType,
} from '@aivastra/types';
import { requireAdmin } from './guard.js';
import { AppError } from '../../lib/errors.js';

export async function adminAssetsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // ── Faces ─────────────────────────────────────────────────────────────────

  app.get('/admin/assets/faces', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.modelFaces);
    const tmplCounts = await app.db
      .select({ faceId: schema.modelPoses.faceId, cnt: count() })
      .from(schema.modelPoses)
      .where(eq(schema.modelPoses.isTemplate, true))
      .groupBy(schema.modelPoses.faceId);
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
    const { contentType, thumbnailContentType } = req.body as { contentType: string; thumbnailContentType?: string };
    const newId = randomUUID();
    const r2Key = keys.modelBackground(newId);
    const thumbKey = keys.modelBackgroundThumb(newId);
    const [main, thumb] = await Promise.all([
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, thumbnailContentType ?? contentType, 1_000_000, 300),
    ]);
    return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
  });

  app.post('/admin/assets/backgrounds/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelBackgroundBody },
  }, async (req) => {
    const body = req.body as {
      label: string; r2Key: string; thumbnailKey: string; sortOrder: number;
    };
    const [row] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        label: body.label,
        r2Key: body.r2Key,
        thumbnailKey: body.thumbnailKey,
        sortOrder: body.sortOrder,
      })
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

    await Promise.allSettled([
      app.storage.deleteObject(bg.r2Key),
      app.storage.deleteObject(bg.thumbnailKey),
    ]);
    await app.db.delete(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, id));
    return { ok: true };
  });

  app.get('/admin/assets/poses', {
    preHandler: W,
    schema: {
      querystring: z.object({
        garmentTypeId: z.string().uuid(),
        faceId: z.string().uuid().optional(),
        backgroundId: z.string().uuid().optional(),
      }),
    },
  }, async (req) => {
    const { garmentTypeId, faceId, backgroundId } = req.query as {
      garmentTypeId: string; faceId?: string; backgroundId?: string;
    };
    const conditions = [eq(schema.modelPoses.subcategoryId, garmentTypeId)];
    if (faceId) conditions.push(eq(schema.modelPoses.faceId, faceId));
    if (backgroundId) conditions.push(eq(schema.modelPoses.backgroundId, backgroundId));
    const rows = await app.db.select().from(schema.modelPoses).where(and(...conditions));
    return { items: rows };
  });

  app.post('/admin/assets/poses/presign', {
    preHandler: W,
    schema: { body: PresignModelPoseBody },
  }, async (req) => {
    const body = req.body as z.infer<typeof PresignModelPoseBody>;
    const { garmentTypeId, contentType, faceSideContentType, bgComfyContentType } = body;

    const [sub] = await app.db.select().from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));
    if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

    if (body.faceId) {
      const [face] = await app.db.select({ id: schema.modelFaces.id })
        .from(schema.modelFaces).where(eq(schema.modelFaces.id, body.faceId));
      if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');
    }

    if (body.backgroundId) {
      const [bg] = await app.db.select({ id: schema.modelBackgrounds.id })
        .from(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, body.backgroundId));
      if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');
    }

    const newId = randomUUID();
    const r2Key = keys.modelPose(newId);
    const thumbKey = keys.modelPoseThumb(newId);
    const faceSideKey = keys.modelPoseFaceSide(newId);
    const bgComfyKey = keys.modelPoseBgComfy(newId);

    const presignTasks: Promise<{ url: string }>[] = [
      app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
      app.storage.presignPut(thumbKey, contentType, 1_000_000, 300),
      app.storage.presignPut(faceSideKey, faceSideContentType, 10_000_000, 300),
      app.storage.presignPut(bgComfyKey, bgComfyContentType, 10_000_000, 300),
    ];

    const newFaceId = body.newFaceContentType ? randomUUID() : null;
    const newFaceR2Key = newFaceId ? keys.modelFace(newFaceId) : null;
    const newFaceThumbKey = newFaceId ? keys.modelFaceThumb(newFaceId) : null;
    if (newFaceId && body.newFaceContentType && newFaceR2Key && newFaceThumbKey) {
      presignTasks.push(app.storage.presignPut(newFaceR2Key, body.newFaceContentType, 10_000_000, 300));
      presignTasks.push(app.storage.presignPut(newFaceThumbKey, body.newFaceContentType, 1_000_000, 300));
    }

    const newBgId = body.newBgContentType ? randomUUID() : null;
    const newBgR2Key = newBgId ? keys.modelBackground(newBgId) : null;
    const newBgThumbKey = newBgId ? keys.modelBackgroundThumb(newBgId) : null;
    if (newBgId && body.newBgContentType && newBgR2Key && newBgThumbKey) {
      presignTasks.push(app.storage.presignPut(newBgR2Key, body.newBgContentType, 10_000_000, 300));
      presignTasks.push(app.storage.presignPut(newBgThumbKey, body.newBgContentType, 1_000_000, 300));
    }

    const results = await Promise.all(presignTasks);
    let idx = 0;
    const uploadUrl = results[idx++]!.url;
    const thumbnailUploadUrl = results[idx++]!.url;
    const faceSideUploadUrl = results[idx++]!.url;
    const bgComfyUploadUrl = results[idx++]!.url;

    const response: Record<string, unknown> = {
      uploadUrl, r2Key, thumbnailUploadUrl, thumbnailKey: thumbKey,
      faceSideUploadUrl, faceSideR2Key: faceSideKey,
      bgComfyUploadUrl, bgComfyR2Key: bgComfyKey,
    };

    if (newFaceId && newFaceR2Key && newFaceThumbKey) {
      response['newFaceUploadUrl'] = results[idx++]!.url;
      response['newFaceR2Key'] = newFaceR2Key;
      response['newFaceThumbnailUploadUrl'] = results[idx++]!.url;
      response['newFaceThumbnailKey'] = newFaceThumbKey;
    }

    if (newBgId && newBgR2Key && newBgThumbKey) {
      response['newBgUploadUrl'] = results[idx++]!.url;
      response['newBgR2Key'] = newBgR2Key;
      response['newBgThumbnailUploadUrl'] = results[idx++]!.url;
      response['newBgThumbnailKey'] = newBgThumbKey;
    }

    return response;
  });

  app.post('/admin/assets/poses/confirm', {
    preHandler: W,
    schema: { body: ConfirmModelPoseBody },
  }, async (req) => {
    const body = req.body as z.infer<typeof ConfirmModelPoseBody>;

    // Validate garmentTypeId exists
    const [subCheck] = await app.db.select({ genderSlug: schema.garmentSubcategories.genderSlug })
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, body.garmentTypeId));
    if (!subCheck) throw new AppError('NOT_FOUND', 404, 'garment type not found');

    // Validate workflowTemplateId exists and is active
    const [wfCheck] = await app.db
      .select({ id: schema.workflowTemplates.id })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, body.workflowTemplateId));
    if (!wfCheck) throw new AppError('NOT_FOUND', 404, 'workflow template not found');

    const row = await app.db.transaction(async (tx) => {
      let resolvedFaceId = body.faceId ?? '';
      if (body.newFace) {
        const gender = subCheck.genderSlug;
        const autoLabel = body.newFace.filename.replace(/\.[^.]+$/, '');
        const [newFaceRow] = await tx
          .insert(schema.modelFaces)
          .values({ label: autoLabel, gender, r2Key: body.newFace.r2Key, thumbnailKey: body.newFace.thumbnailKey, sortOrder: 0 })
          .returning({ id: schema.modelFaces.id });
        resolvedFaceId = newFaceRow!.id;
      }

      let resolvedBgId = body.backgroundId ?? '';
      if (body.newBackground) {
        const autoLabel = body.newBackground.filename.replace(/\.[^.]+$/, '');
        const [newBgRow] = await tx
          .insert(schema.modelBackgrounds)
          .values({ label: autoLabel, r2Key: body.newBackground.r2Key, thumbnailKey: body.newBackground.thumbnailKey, sortOrder: 0 })
          .returning({ id: schema.modelBackgrounds.id });
        resolvedBgId = newBgRow!.id;
      }

      if (body.isTemplate) {
        await tx.update(schema.modelPoses)
          .set({ isTemplate: false, updatedAt: new Date() })
          .where(and(
            eq(schema.modelPoses.subcategoryId, body.garmentTypeId),
            eq(schema.modelPoses.faceId, resolvedFaceId),
            eq(schema.modelPoses.backgroundId, resolvedBgId),
            eq(schema.modelPoses.isTemplate, true),
          ));
      }

      const [inserted] = await tx
        .insert(schema.modelPoses)
        .values({
          subcategoryId: body.garmentTypeId,
          faceId: resolvedFaceId,
          backgroundId: resolvedBgId,
          label: body.label,
          r2Key: body.r2Key,
          thumbnailKey: body.thumbnailKey,
          faceSideR2Key: body.faceSideR2Key,
          bgComfyR2Key: body.bgComfyR2Key,
          workflowTemplateId: body.workflowTemplateId,
          promptFacePhase: body.promptFacePhase,
          promptGarmentPhase: body.promptGarmentPhase,
          showsLower: body.showsLower,
          showsShoes: body.showsShoes,
          isTemplate: body.isTemplate,
          sortOrder: body.sortOrder,
        })
        .returning();
      return inserted;
    });

    return row;
  });

  // ── Pose face-side re-upload ──────────────────────────────────────────────
  app.post('/admin/assets/poses/:id/presign-faceside', {
    preHandler: W,
    schema: { params: uuidParam, body: z.object({ contentType: AssetContentType }) },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { contentType } = req.body as { contentType: string };
    const [pose] = await app.db.select({ id: schema.modelPoses.id }).from(schema.modelPoses).where(eq(schema.modelPoses.id, id));
    if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
    const r2Key = keys.modelPoseFaceSide(id);
    const uploadUrl = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
    return { uploadUrl, r2Key };
  });

  app.patch('/admin/assets/poses/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: PatchModelPoseBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { isTemplate?: boolean; workflowTemplateId?: string; [key: string]: unknown };

    // Validate workflowTemplateId if provided
    if (body.workflowTemplateId) {
      const [wfCheck] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, body.workflowTemplateId));
      if (!wfCheck) throw new AppError('NOT_FOUND', 404, 'workflow template not found');
    }

    if (body.isTemplate === true) {
      const [pose] = await app.db.select().from(schema.modelPoses).where(eq(schema.modelPoses.id, id));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
      await app.db.transaction(async (tx) => {
        await tx.update(schema.modelPoses)
          .set({ isTemplate: false, updatedAt: new Date() })
          .where(and(
            eq(schema.modelPoses.subcategoryId, pose.subcategoryId),
            eq(schema.modelPoses.faceId, pose.faceId),
            eq(schema.modelPoses.backgroundId, pose.backgroundId),
            eq(schema.modelPoses.isTemplate, true),
          ));
        await tx.update(schema.modelPoses)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.modelPoses.id, id));
      });
    } else {
      const [updated] = await app.db
        .update(schema.modelPoses)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.modelPoses.id, id))
        .returning({ id: schema.modelPoses.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'pose not found');
    }
    return { ok: true };
  });

  app.delete('/admin/assets/poses/:id', {
    preHandler: W,
    schema: {
      params: uuidParam,
      querystring: z.object({ force: z.coerce.boolean().optional().default(false) }),
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { force } = req.query as { force: boolean };
    const [pose] = await app.db.select().from(schema.modelPoses)
      .where(eq(schema.modelPoses.id, id));
    if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');

    const jobRefs = await app.db.select({ jobId: schema.jobInputs.jobId })
      .from(schema.jobInputs).where(eq(schema.jobInputs.poseId, id));

    if (jobRefs.length > 0 && !force) {
      throw new AppError('CONFLICT', 409, `pose is referenced by ${jobRefs.length} job(s) — delete with ?force=true to also remove those jobs`);
    }

    if (jobRefs.length > 0 && force) {
      // Delete referencing jobs (cascades to job_inputs, job_outputs, job_events)
      const jobIds = jobRefs.map((r) => r.jobId);
      await app.db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
    }

    await Promise.allSettled([
      app.storage.deleteObject(pose.r2Key),
      app.storage.deleteObject(pose.thumbnailKey),
    ]);
    await app.db.delete(schema.modelPoses).where(eq(schema.modelPoses.id, id));
    return { ok: true };
  });
}
