import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  AssetContentType,
  ClonePoseBody,
  ClonePosesBulkBody,
  ConfirmModelBackgroundBody,
  ConfirmModelFaceBody,
  ConfirmModelPoseBody,
  PatchModelBackgroundBody,
  PatchModelFaceBody,
  PatchModelPoseBody,
  PresignModelBackgroundBody,
  PresignModelFaceBody,
  PresignModelPoseBody,
} from '@aivastra/types';
import AdmZip from 'adm-zip';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminAssetsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // ── Faces ─────────────────────────────────────────────────────────────────

  app.get('/admin/assets/faces', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.modelFaces);
    return { items: rows };
  });

  app.post(
    '/admin/assets/faces/presign',
    {
      preHandler: W,
      schema: { body: PresignModelFaceBody },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const newId = randomUUID();
      const r2Key = keys.modelFace(newId);
      const thumbKey = keys.modelFaceThumb(newId);
      const [main, thumb] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        // Thumbnails are downscaled to JPEG client-side — sign the PUT for image/jpeg
        // so the signed Content-Type header matches what the browser sends.
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
      ]);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
    },
  );

  app.post(
    '/admin/assets/faces/confirm',
    {
      preHandler: W,
      schema: { body: ConfirmModelFaceBody },
    },
    async (req) => {
      const { label, gender, r2Key, thumbnailKey, sortOrder } = req.body as {
        label: string;
        gender: string;
        r2Key: string;
        thumbnailKey: string;
        sortOrder: number;
      };
      const [row] = await app.db
        .insert(schema.modelFaces)
        .values({ label, gender, r2Key, thumbnailKey, sortOrder })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/faces/:id',
    {
      preHandler: W,
      schema: { params: uuidParam, body: PatchModelFaceBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [updated] = await app.db
        .update(schema.modelFaces)
        .set({ ...(req.body as object), updatedAt: new Date() })
        .where(eq(schema.modelFaces.id, id))
        .returning({ id: schema.modelFaces.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'face not found');
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/faces/:id',
    {
      preHandler: W,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [face] = await app.db
        .select()
        .from(schema.modelFaces)
        .where(eq(schema.modelFaces.id, id));
      if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');

      const jobRef = await app.db
        .select({ jobId: schema.jobInputs.jobId })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.faceId, id))
        .limit(1);
      if (jobRef.length > 0)
        throw new AppError('CONFLICT', 409, 'face is referenced by existing jobs');

      await Promise.allSettled([
        app.storage.deleteObject(face.r2Key),
        app.storage.deleteObject(face.thumbnailKey),
      ]);
      await app.db.delete(schema.modelFaces).where(eq(schema.modelFaces.id, id));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/faces',
    {
      preHandler: W,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      const faces = await app.db
        .select()
        .from(schema.modelFaces)
        .where(inArray(schema.modelFaces.id, ids));
      await Promise.allSettled(
        faces.flatMap((f) => [
          app.storage.deleteObject(f.r2Key),
          app.storage.deleteObject(f.thumbnailKey),
        ]),
      );
      await app.db.delete(schema.modelFaces).where(inArray(schema.modelFaces.id, ids));
      return { deleted: faces.length };
    },
  );

  // ── Backgrounds (global) ──────────────────────────────────────────────────

  app.get(
    '/admin/assets/backgrounds',
    {
      preHandler: W,
      schema: { querystring: z.object({ genderSlug: z.string().optional() }) },
    },
    async (req) => {
      const { genderSlug } = req.query as { genderSlug?: string };
      const rows = await app.db
        .select()
        .from(schema.modelBackgrounds)
        .where(genderSlug ? eq(schema.modelBackgrounds.genderSlug, genderSlug) : undefined);
      return { items: rows };
    },
  );

  app.post(
    '/admin/assets/backgrounds/presign',
    {
      preHandler: W,
      schema: { body: PresignModelBackgroundBody },
    },
    async (req) => {
      const { contentType, thumbnailContentType } = req.body as {
        contentType: string;
        thumbnailContentType?: string;
      };
      const newId = randomUUID();
      const r2Key = keys.modelBackground(newId);
      const thumbKey = keys.modelBackgroundThumb(newId);
      const [main, thumb] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        // Thumbnails are downscaled to JPEG client-side; sign for image/jpeg.
        app.storage.presignPut(thumbKey, thumbnailContentType ?? 'image/jpeg', 1_000_000, 300),
      ]);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
    },
  );

  app.post(
    '/admin/assets/backgrounds/confirm',
    {
      preHandler: W,
      schema: { body: ConfirmModelBackgroundBody },
    },
    async (req) => {
      const body = req.body as {
        label: string;
        r2Key: string;
        thumbnailKey: string;
        sortOrder: number;
        genderSlug?: string;
        isWhiteBg?: boolean;
      };
      // If marking this background as white, unset all other backgrounds' isWhiteBg first
      if (body.isWhiteBg) {
        await app.db
          .update(schema.modelBackgrounds)
          .set({ isWhiteBg: false })
          .where(eq(schema.modelBackgrounds.isWhiteBg, true));
      }
      const [row] = await app.db
        .insert(schema.modelBackgrounds)
        .values({
          label: body.label,
          r2Key: body.r2Key,
          thumbnailKey: body.thumbnailKey,
          sortOrder: body.sortOrder,
          genderSlug: body.genderSlug ?? null,
          isWhiteBg: body.isWhiteBg ?? false,
        })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/backgrounds/:id',
    {
      preHandler: W,
      schema: { params: uuidParam, body: PatchModelBackgroundBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      // If marking this background as white, unset all other backgrounds' isWhiteBg first
      if (body.isWhiteBg === true) {
        await app.db
          .update(schema.modelBackgrounds)
          .set({ isWhiteBg: false })
          .where(eq(schema.modelBackgrounds.isWhiteBg, true));
      }
      const [updated] = await app.db
        .update(schema.modelBackgrounds)
        .set({ ...(body as object), updatedAt: new Date() })
        .where(eq(schema.modelBackgrounds.id, id))
        .returning({ id: schema.modelBackgrounds.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'background not found');
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/backgrounds/:id',
    {
      preHandler: W,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [bg] = await app.db
        .select()
        .from(schema.modelBackgrounds)
        .where(eq(schema.modelBackgrounds.id, id));
      if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');

      const jobRef = await app.db
        .select({ jobId: schema.jobInputs.jobId })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.backgroundId, id))
        .limit(1);
      if (jobRef.length > 0)
        throw new AppError('CONFLICT', 409, 'background is referenced by existing jobs');

      await Promise.allSettled([
        app.storage.deleteObject(bg.r2Key),
        app.storage.deleteObject(bg.thumbnailKey),
      ]);
      await app.db.delete(schema.modelBackgrounds).where(eq(schema.modelBackgrounds.id, id));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/backgrounds',
    {
      preHandler: W,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      const bgs = await app.db
        .select()
        .from(schema.modelBackgrounds)
        .where(inArray(schema.modelBackgrounds.id, ids));
      await Promise.allSettled(
        bgs.flatMap((b) => [
          app.storage.deleteObject(b.r2Key),
          app.storage.deleteObject(b.thumbnailKey),
        ]),
      );
      await app.db.delete(schema.modelBackgrounds).where(inArray(schema.modelBackgrounds.id, ids));
      return { deleted: bgs.length };
    },
  );

  app.get(
    '/admin/assets/poses',
    {
      preHandler: W,
      schema: {
        querystring: z.object({
          garmentTypeId: z.string().uuid(),
          faceId: z.string().uuid().optional(),
          backgroundId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { garmentTypeId, faceId, backgroundId } = req.query as {
        garmentTypeId: string;
        faceId?: string;
        backgroundId?: string;
      };
      const conditions = [eq(schema.modelPoses.subcategoryId, garmentTypeId)];
      if (faceId) conditions.push(eq(schema.modelPoses.faceId, faceId));
      if (backgroundId) conditions.push(eq(schema.modelPoses.backgroundId, backgroundId));
      const rows = await app.db
        .select({
          ...getTableColumns(schema.modelPoses),
          workflowLabel: schema.workflowTemplates.label,
        })
        .from(schema.modelPoses)
        .leftJoin(
          schema.workflowTemplates,
          eq(schema.modelPoses.workflowTemplateId, schema.workflowTemplates.id),
        )
        .where(and(...conditions));
      return { items: rows };
    },
  );

  app.post(
    '/admin/assets/poses/presign',
    {
      preHandler: W,
      schema: { body: PresignModelPoseBody },
    },
    async (req) => {
      const body = req.body as z.infer<typeof PresignModelPoseBody>;
      const { garmentTypeId, contentType, faceSideContentType, bgComfyContentType } = body;

      const [sub] = await app.db
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, garmentTypeId));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      if (body.faceId) {
        const [face] = await app.db
          .select({ id: schema.modelFaces.id })
          .from(schema.modelFaces)
          .where(eq(schema.modelFaces.id, body.faceId));
        if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');
      }

      if (body.backgroundId) {
        const [bg] = await app.db
          .select({ id: schema.modelBackgrounds.id })
          .from(schema.modelBackgrounds)
          .where(eq(schema.modelBackgrounds.id, body.backgroundId));
        if (!bg) throw new AppError('NOT_FOUND', 404, 'background not found');
      }

      const newId = randomUUID();
      const r2Key = keys.modelPose(newId);
      const thumbKey = keys.modelPoseThumb(newId);
      const faceSideKey = faceSideContentType ? keys.modelPoseFaceSide(newId) : null;
      const bgComfyKey = bgComfyContentType ? keys.modelPoseBgComfy(newId) : null;

      const presignTasks: Promise<{ url: string }>[] = [
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        // Thumbnails are downscaled to JPEG client-side; sign for image/jpeg.
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
      ];
      if (faceSideKey && faceSideContentType)
        presignTasks.push(
          app.storage.presignPut(faceSideKey, faceSideContentType, 10_000_000, 300),
        );
      if (bgComfyKey && bgComfyContentType)
        presignTasks.push(app.storage.presignPut(bgComfyKey, bgComfyContentType, 10_000_000, 300));

      const newFaceId = body.newFaceContentType ? randomUUID() : null;
      const newFaceR2Key = newFaceId ? keys.modelFace(newFaceId) : null;
      const newFaceThumbKey = newFaceId ? keys.modelFaceThumb(newFaceId) : null;
      if (newFaceId && body.newFaceContentType && newFaceR2Key && newFaceThumbKey) {
        presignTasks.push(
          app.storage.presignPut(newFaceR2Key, body.newFaceContentType, 10_000_000, 300),
        );
        presignTasks.push(app.storage.presignPut(newFaceThumbKey, 'image/jpeg', 1_000_000, 300));
      }

      const newBgId = body.newBgContentType ? randomUUID() : null;
      const newBgR2Key = newBgId ? keys.modelBackground(newBgId) : null;
      const newBgThumbKey = newBgId ? keys.modelBackgroundThumb(newBgId) : null;
      if (newBgId && body.newBgContentType && newBgR2Key && newBgThumbKey) {
        presignTasks.push(
          app.storage.presignPut(newBgR2Key, body.newBgContentType, 10_000_000, 300),
        );
        presignTasks.push(app.storage.presignPut(newBgThumbKey, 'image/jpeg', 1_000_000, 300));
      }

      const results = await Promise.all(presignTasks);
      let idx = 0;
      const uploadUrl = results[idx++]?.url;
      const thumbnailUploadUrl = results[idx++]?.url;
      const faceSideUploadUrl = faceSideKey ? results[idx++]?.url : undefined;
      const bgComfyUploadUrl = bgComfyKey ? results[idx++]?.url : undefined;

      const response: Record<string, unknown> = {
        uploadUrl,
        r2Key,
        thumbnailUploadUrl,
        thumbnailKey: thumbKey,
      };
      if (faceSideUploadUrl && faceSideKey) {
        response.faceSideUploadUrl = faceSideUploadUrl;
        response.faceSideR2Key = faceSideKey;
      }
      if (bgComfyUploadUrl && bgComfyKey) {
        response.bgComfyUploadUrl = bgComfyUploadUrl;
        response.bgComfyR2Key = bgComfyKey;
      }

      if (newFaceId && newFaceR2Key && newFaceThumbKey) {
        response.newFaceUploadUrl = results[idx++]?.url;
        response.newFaceR2Key = newFaceR2Key;
        response.newFaceThumbnailUploadUrl = results[idx++]?.url;
        response.newFaceThumbnailKey = newFaceThumbKey;
      }

      if (newBgId && newBgR2Key && newBgThumbKey) {
        response.newBgUploadUrl = results[idx++]?.url;
        response.newBgR2Key = newBgR2Key;
        response.newBgThumbnailUploadUrl = results[idx++]?.url;
        response.newBgThumbnailKey = newBgThumbKey;
      }

      return response;
    },
  );

  app.post(
    '/admin/assets/poses/confirm',
    {
      preHandler: W,
      schema: { body: ConfirmModelPoseBody },
    },
    async (req) => {
      const body = req.body as z.infer<typeof ConfirmModelPoseBody>;

      // Validate garmentTypeId exists
      const [subCheck] = await app.db
        .select({ genderSlug: schema.garmentSubcategories.genderSlug })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, body.garmentTypeId));
      if (!subCheck) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      // Validate workflowTemplateId exists and derive lower/shoe capability from it
      const [wfCheck] = await app.db
        .select({
          id: schema.workflowTemplates.id,
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
        })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, body.workflowTemplateId));
      if (!wfCheck) throw new AppError('NOT_FOUND', 404, 'workflow template not found');
      const derivedShowsLower = wfCheck.lowerNodeId != null;
      const derivedShowsShoes = wfCheck.shoeNodeId != null;

      const row = await app.db.transaction(async (tx) => {
        let resolvedFaceId = body.faceId ?? '';
        if (body.newFace) {
          const gender = subCheck.genderSlug;
          const autoLabel = body.newFace.filename.replace(/\.[^.]+$/, '');
          const [newFaceRow] = await tx
            .insert(schema.modelFaces)
            .values({
              label: autoLabel,
              gender,
              r2Key: body.newFace.r2Key,
              thumbnailKey: body.newFace.thumbnailKey,
              sortOrder: 0,
            })
            .returning({ id: schema.modelFaces.id });
          resolvedFaceId = newFaceRow?.id;
        }

        let resolvedBgId = body.backgroundId ?? '';
        if (body.newBackground) {
          const autoLabel = body.newBackground.filename.replace(/\.[^.]+$/, '');
          const [newBgRow] = await tx
            .insert(schema.modelBackgrounds)
            .values({
              label: autoLabel,
              genderSlug: subCheck.genderSlug,
              r2Key: body.newBackground.r2Key,
              thumbnailKey: body.newBackground.thumbnailKey,
              sortOrder: 0,
            })
            .returning({ id: schema.modelBackgrounds.id });
          resolvedBgId = newBgRow?.id;
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
            showsLower: derivedShowsLower,
            showsShoes: derivedShowsShoes,
            sortOrder: body.sortOrder,
          })
          .returning();
        return inserted;
      });

      return row;
    },
  );

  // ── Pose face-side re-upload ──────────────────────────────────────────────
  app.post(
    '/admin/assets/poses/:id/presign-faceside',
    {
      preHandler: W,
      schema: { params: uuidParam, body: z.object({ contentType: AssetContentType }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const [pose] = await app.db
        .select({ id: schema.modelPoses.id })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.id, id));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
      const r2Key = keys.modelPoseFaceSide(id);
      const { url: uploadUrl } = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      return { uploadUrl, r2Key };
    },
  );

  // ── Pose image re-upload ─────────────────────────────────────────────────
  app.post(
    '/admin/assets/poses/:id/presign-pose',
    {
      preHandler: W,
      schema: { params: uuidParam, body: z.object({ contentType: AssetContentType }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const [pose] = await app.db
        .select({ id: schema.modelPoses.id })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.id, id));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
      const r2Key = keys.modelPose(id);
      const thumbnailKey = keys.modelPoseThumb(id);
      const [main, thumb] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        // Thumbnails are downscaled to JPEG client-side; sign for image/jpeg.
        app.storage.presignPut(thumbnailKey, 'image/jpeg', 1_000_000, 300),
      ]);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey };
    },
  );

  // ── ComfyUI background re-upload ──────────────────────────────────────────
  app.post(
    '/admin/assets/poses/:id/presign-bgcomfy',
    {
      preHandler: W,
      schema: { params: uuidParam, body: z.object({ contentType: AssetContentType }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const [pose] = await app.db
        .select({ id: schema.modelPoses.id })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.id, id));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');
      const r2Key = keys.modelPoseBgComfy(id);
      const { url: uploadUrl } = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      return { uploadUrl, r2Key };
    },
  );

  app.patch(
    '/admin/assets/poses/:id',
    {
      preHandler: W,
      schema: { params: uuidParam, body: PatchModelPoseBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        workflowTemplateId?: string;
        [key: string]: unknown;
      };

      // Validate workflowTemplateId if provided, and derive showsLower/showsShoes from it
      if (body.workflowTemplateId) {
        const [wfCheck] = await app.db
          .select({
            id: schema.workflowTemplates.id,
            lowerNodeId: schema.workflowTemplates.lowerNodeId,
            shoeNodeId: schema.workflowTemplates.shoeNodeId,
          })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, body.workflowTemplateId));
        if (!wfCheck) throw new AppError('NOT_FOUND', 404, 'workflow template not found');
        (body as Record<string, unknown>).showsLower = wfCheck.lowerNodeId != null;
        (body as Record<string, unknown>).showsShoes = wfCheck.shoeNodeId != null;
      }

      const poseFields = body as Record<string, unknown>;

      await app.db.transaction(async (tx) => {
        if (Object.keys(poseFields).length > 0) {
          const [updated] = await tx
            .update(schema.modelPoses)
            .set({ ...poseFields, updatedAt: new Date() })
            .where(eq(schema.modelPoses.id, id))
            .returning({ id: schema.modelPoses.id });
          if (!updated) throw new AppError('NOT_FOUND', 404, 'pose not found');
        }
      });
      return { ok: true };
    },
  );

  app.post(
    '/admin/assets/poses/:id/clone',
    { preHandler: W, schema: { params: uuidParam, body: ClonePoseBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { targetGarmentTypeIds } = req.body as { targetGarmentTypeIds: string[] };

      const [source] = await app.db
        .select()
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.id, id));
      if (!source) throw new AppError('NOT_FOUND', 404, 'pose not found');

      const validSubs = await app.db
        .select({ id: schema.garmentSubcategories.id })
        .from(schema.garmentSubcategories)
        .where(inArray(schema.garmentSubcategories.id, targetGarmentTypeIds));
      if (validSubs.length !== targetGarmentTypeIds.length)
        throw new AppError('BAD_CATALOG', 400, 'one or more garment types not found');

      // Find which targets already have this exact pose image (same r2Key)
      const existing = await app.db
        .select({ subcategoryId: schema.modelPoses.subcategoryId })
        .from(schema.modelPoses)
        .where(
          and(
            inArray(schema.modelPoses.subcategoryId, targetGarmentTypeIds),
            eq(schema.modelPoses.r2Key, source.r2Key),
          ),
        );
      const existingIds = new Set(existing.map((r) => r.subcategoryId));
      const toCreate = targetGarmentTypeIds.filter((tid) => !existingIds.has(tid));

      if (toCreate.length === 0)
        return { created: 0, skipped: targetGarmentTypeIds.length, ids: [] };

      const inserted = await app.db
        .insert(schema.modelPoses)
        .values(
          toCreate.map((subcategoryId) => ({
            subcategoryId,
            faceId: source.faceId,
            backgroundId: source.backgroundId,
            label: source.label,
            r2Key: source.r2Key,
            thumbnailKey: source.thumbnailKey,
            faceSideR2Key: source.faceSideR2Key,
            bgComfyR2Key: source.bgComfyR2Key,
            workflowTemplateId: source.workflowTemplateId,
            promptFacePhase: source.promptFacePhase,
            promptGarmentPhase: source.promptGarmentPhase,
            showsLower: source.showsLower,
            showsShoes: source.showsShoes,
            sortOrder: source.sortOrder,
            isActive: source.isActive,
          })),
        )
        .returning({ id: schema.modelPoses.id });

      return {
        created: inserted.length,
        skipped: existingIds.size,
        ids: inserted.map((r) => r.id),
      };
    },
  );

  app.post(
    '/admin/assets/poses/clone-bulk',
    { preHandler: W, schema: { body: ClonePosesBulkBody } },
    async (req) => {
      const { poseIds, targetGarmentTypeIds } = req.body as {
        poseIds: string[];
        targetGarmentTypeIds: string[];
      };

      const sources = await app.db
        .select()
        .from(schema.modelPoses)
        .where(inArray(schema.modelPoses.id, poseIds));
      if (sources.length === 0) throw new AppError('NOT_FOUND', 404, 'no poses found');

      const validSubs = await app.db
        .select({ id: schema.garmentSubcategories.id })
        .from(schema.garmentSubcategories)
        .where(inArray(schema.garmentSubcategories.id, targetGarmentTypeIds));
      if (validSubs.length !== targetGarmentTypeIds.length)
        throw new AppError('BAD_CATALOG', 400, 'one or more garment types not found');

      let created = 0;
      let skipped = 0;
      const ids: string[] = [];

      for (const source of sources) {
        const existing = await app.db
          .select({ subcategoryId: schema.modelPoses.subcategoryId })
          .from(schema.modelPoses)
          .where(
            and(
              inArray(schema.modelPoses.subcategoryId, targetGarmentTypeIds),
              eq(schema.modelPoses.r2Key, source.r2Key),
            ),
          );
        const existingIds = new Set(existing.map((r) => r.subcategoryId));
        const toCreate = targetGarmentTypeIds.filter((tid) => !existingIds.has(tid));
        skipped += existingIds.size;

        if (toCreate.length === 0) continue;

        const inserted = await app.db
          .insert(schema.modelPoses)
          .values(
            toCreate.map((subcategoryId) => ({
              subcategoryId,
              faceId: source.faceId,
              backgroundId: source.backgroundId,
              label: source.label,
              r2Key: source.r2Key,
              thumbnailKey: source.thumbnailKey,
              faceSideR2Key: source.faceSideR2Key,
              bgComfyR2Key: source.bgComfyR2Key,
              workflowTemplateId: source.workflowTemplateId,
              promptFacePhase: source.promptFacePhase,
              promptGarmentPhase: source.promptGarmentPhase,
              showsLower: source.showsLower,
              showsShoes: source.showsShoes,
              sortOrder: source.sortOrder,
              isActive: source.isActive,
            })),
          )
          .returning({ id: schema.modelPoses.id });

        created += inserted.length;
        ids.push(...inserted.map((r) => r.id));
      }

      return { created, skipped, ids };
    },
  );

  app.delete(
    '/admin/assets/poses',
    {
      preHandler: W,
      schema: {
        body: z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }),
      },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      const poses = await app.db
        .select()
        .from(schema.modelPoses)
        .where(inArray(schema.modelPoses.id, ids));
      if (poses.length === 0) return { deleted: 0 };

      const jobRefs = await app.db
        .select({ jobId: schema.jobInputs.jobId })
        .from(schema.jobInputs)
        .where(inArray(schema.jobInputs.poseId, ids));

      if (jobRefs.length > 0) {
        const jobIds = [...new Set(jobRefs.map((r) => r.jobId))];
        await app.db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
      }

      await app.db.delete(schema.modelPoses).where(inArray(schema.modelPoses.id, ids));
      // R2 objects are owned by model_pose_assets rows — not deleted here.
      return { deleted: poses.length };
    },
  );

  app.delete(
    '/admin/assets/poses/:id',
    {
      preHandler: W,
      schema: {
        params: uuidParam,
        querystring: z.object({ force: z.coerce.boolean().optional().default(false) }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { force } = req.query as { force: boolean };
      const [pose] = await app.db
        .select()
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.id, id));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');

      const jobRefs = await app.db
        .select({ jobId: schema.jobInputs.jobId })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.poseId, id));

      if (jobRefs.length > 0 && !force) {
        throw new AppError(
          'CONFLICT',
          409,
          `pose is referenced by ${jobRefs.length} job(s) — delete with ?force=true to also remove those jobs`,
        );
      }

      if (jobRefs.length > 0 && force) {
        // Delete referencing jobs (cascades to job_inputs, job_outputs, job_events)
        const jobIds = jobRefs.map((r) => r.jobId);
        await app.db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
      }

      await app.db.delete(schema.modelPoses).where(eq(schema.modelPoses.id, id));
      // R2 objects are owned by model_pose_assets rows — not deleted here.
      return { ok: true };
    },
  );

  // ── Pose Assets (centralised R2 object management) ───────────────────────

  app.get('/admin/assets/pose-assets', { preHandler: W }, async () => {
    const rows = await app.db
      .select({
        id: schema.modelPoseAssets.id,
        label: schema.modelPoseAssets.label,
        r2Key: schema.modelPoseAssets.r2Key,
        faceSideR2Key: schema.modelPoseAssets.faceSideR2Key,
        bgComfyR2Key: schema.modelPoseAssets.bgComfyR2Key,
        thumbnailKey: schema.modelPoseAssets.thumbnailKey,
        genderSlug: schema.modelPoseAssets.genderSlug,
        faceId: schema.modelPoseAssets.faceId,
        backgroundId: schema.modelPoseAssets.backgroundId,
        workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
        promptGarmentPhase: schema.modelPoseAssets.promptGarmentPhase,
        createdAt: schema.modelPoseAssets.createdAt,
      })
      .from(schema.modelPoseAssets)
      .orderBy(schema.modelPoseAssets.label);
    return { items: rows };
  });

  // Presign for a new pose asset image upload (full: pose + faceSide + bgComfy + optional new face/bg)
  app.post(
    '/admin/assets/pose-assets/presign',
    {
      preHandler: W,
      schema: {
        body: z.object({
          contentType: AssetContentType,
          faceSideContentType: AssetContentType.optional(),
          bgComfyContentType: AssetContentType.optional(),
          newFaceContentType: AssetContentType.optional(),
          newBgContentType: AssetContentType.optional(),
        }),
      },
    },
    async (req) => {
      const body = req.body as {
        contentType: string;
        faceSideContentType?: string;
        bgComfyContentType?: string;
        newFaceContentType?: string;
        newBgContentType?: string;
      };
      const newId = randomUUID();
      const r2Key = keys.modelPose(newId);
      const thumbKey = keys.modelPoseThumb(newId);
      const faceSideKey = body.faceSideContentType ? keys.modelPoseFaceSide(newId) : null;
      const bgComfyKey = body.bgComfyContentType ? keys.modelPoseBgComfy(newId) : null;

      const presignTasks: Promise<{ url: string }>[] = [
        app.storage.presignPut(r2Key, body.contentType, 10_000_000, 300),
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
      ];
      if (faceSideKey && body.faceSideContentType)
        presignTasks.push(
          app.storage.presignPut(faceSideKey, body.faceSideContentType, 10_000_000, 300),
        );
      if (bgComfyKey && body.bgComfyContentType)
        presignTasks.push(
          app.storage.presignPut(bgComfyKey, body.bgComfyContentType, 10_000_000, 300),
        );

      const newFaceId = body.newFaceContentType ? randomUUID() : null;
      const newFaceR2Key = newFaceId ? keys.modelFace(newFaceId) : null;
      const newFaceThumbKey = newFaceId ? keys.modelFaceThumb(newFaceId) : null;
      if (newFaceId && body.newFaceContentType && newFaceR2Key && newFaceThumbKey) {
        presignTasks.push(
          app.storage.presignPut(newFaceR2Key, body.newFaceContentType, 10_000_000, 300),
        );
        presignTasks.push(app.storage.presignPut(newFaceThumbKey, 'image/jpeg', 1_000_000, 300));
      }

      const newBgId = body.newBgContentType ? randomUUID() : null;
      const newBgR2Key = newBgId ? keys.modelBackground(newBgId) : null;
      const newBgThumbKey = newBgId ? keys.modelBackgroundThumb(newBgId) : null;
      if (newBgId && body.newBgContentType && newBgR2Key && newBgThumbKey) {
        presignTasks.push(
          app.storage.presignPut(newBgR2Key, body.newBgContentType, 10_000_000, 300),
        );
        presignTasks.push(app.storage.presignPut(newBgThumbKey, 'image/jpeg', 1_000_000, 300));
      }

      const results = await Promise.all(presignTasks);
      let idx = 0;
      const response: Record<string, unknown> = {
        r2Key,
        uploadUrl: results[idx++]?.url,
        thumbnailKey: thumbKey,
        thumbnailUploadUrl: results[idx++]?.url,
      };
      if (faceSideKey && body.faceSideContentType) {
        response.faceSideR2Key = faceSideKey;
        response.faceSideUploadUrl = results[idx++]?.url;
      }
      if (bgComfyKey && body.bgComfyContentType) {
        response.bgComfyR2Key = bgComfyKey;
        response.bgComfyUploadUrl = results[idx++]?.url;
      }
      if (newFaceId && newFaceR2Key && newFaceThumbKey) {
        response.newFaceUploadUrl = results[idx++]?.url;
        response.newFaceR2Key = newFaceR2Key;
        response.newFaceThumbnailUploadUrl = results[idx++]?.url;
        response.newFaceThumbnailKey = newFaceThumbKey;
      }
      if (newBgId && newBgR2Key && newBgThumbKey) {
        response.newBgUploadUrl = results[idx++]?.url;
        response.newBgR2Key = newBgR2Key;
        response.newBgThumbnailUploadUrl = results[idx++]?.url;
        response.newBgThumbnailKey = newBgThumbKey;
      }
      return response;
    },
  );

  // Confirm / create pose asset row after upload
  app.post(
    '/admin/assets/pose-assets',
    {
      preHandler: W,
      schema: {
        body: z.object({
          label: z.string().min(1),
          displayName: z.string().optional(),
          genderSlug: z.string().optional(),
          r2Key: z.string(),
          thumbnailKey: z.string(),
          faceSideR2Key: z.string().optional(),
          bgComfyR2Key: z.string().optional(),
          faceId: z.string().uuid().optional(),
          backgroundId: z.string().uuid().optional(),
          workflowTemplateId: z.string().uuid().optional(),
          promptGarmentPhase: z.string().optional(),
          newFace: z
            .object({ r2Key: z.string(), thumbnailKey: z.string(), filename: z.string() })
            .optional(),
          newBackground: z
            .object({ r2Key: z.string(), thumbnailKey: z.string(), filename: z.string() })
            .optional(),
        }),
      },
    },
    async (req) => {
      const body = req.body as {
        label: string;
        displayName?: string;
        genderSlug?: string;
        r2Key: string;
        thumbnailKey: string;
        faceSideR2Key?: string;
        bgComfyR2Key?: string;
        faceId?: string;
        backgroundId?: string;
        workflowTemplateId?: string;
        promptGarmentPhase?: string;
        newFace?: { r2Key: string; thumbnailKey: string; filename: string };
        newBackground?: { r2Key: string; thumbnailKey: string; filename: string };
      };

      const row = await app.db.transaction(async (tx) => {
        let resolvedFaceId = body.faceId ?? null;
        if (body.newFace) {
          const autoLabel = body.newFace.filename.replace(/\.[^.]+$/, '');
          const [newFaceRow] = await tx
            .insert(schema.modelFaces)
            .values({
              label: autoLabel,
              gender: body.genderSlug ?? 'men',
              r2Key: body.newFace.r2Key,
              thumbnailKey: body.newFace.thumbnailKey,
              sortOrder: 0,
            })
            .returning({ id: schema.modelFaces.id });
          resolvedFaceId = newFaceRow?.id ?? null;
        }

        let resolvedBgId = body.backgroundId ?? null;
        if (body.newBackground) {
          const autoLabel = body.newBackground.filename.replace(/\.[^.]+$/, '');
          const [newBgRow] = await tx
            .insert(schema.modelBackgrounds)
            .values({
              label: autoLabel,
              genderSlug: body.genderSlug ?? 'men',
              r2Key: body.newBackground.r2Key,
              thumbnailKey: body.newBackground.thumbnailKey,
              sortOrder: 0,
            })
            .returning({ id: schema.modelBackgrounds.id });
          resolvedBgId = newBgRow?.id ?? null;
        }

        const [inserted] = await tx
          .insert(schema.modelPoseAssets)
          .values({
            label: body.label,
            displayName: body.displayName ?? null,
            genderSlug: body.genderSlug ?? null,
            r2Key: body.r2Key,
            thumbnailKey: body.thumbnailKey,
            faceSideR2Key: body.faceSideR2Key ?? null,
            bgComfyR2Key: body.bgComfyR2Key ?? null,
            faceId: resolvedFaceId,
            backgroundId: resolvedBgId,
            workflowTemplateId: body.workflowTemplateId ?? null,
            promptGarmentPhase: body.promptGarmentPhase ?? null,
          })
          .returning();
        return inserted;
      });

      return row;
    },
  );

  // Presign pose-asset image replacements
  app.post(
    '/admin/assets/pose-assets/:id/presign-pose',
    { preHandler: W, schema: { params: uuidParam, body: z.object({ contentType: z.string() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const r2Key = keys.modelPose(id);
      const thumbKey = keys.modelPoseThumb(id);
      const [uploadRes, thumbRes] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
      ]);
      return {
        r2Key,
        uploadUrl: uploadRes.url,
        thumbnailKey: thumbKey,
        thumbnailUploadUrl: thumbRes.url,
      };
    },
  );

  app.post(
    '/admin/assets/pose-assets/:id/presign-faceside',
    { preHandler: W, schema: { params: uuidParam, body: z.object({ contentType: z.string() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const r2Key = keys.modelPoseFaceSide(id);
      const res = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      return { r2Key, uploadUrl: res.url };
    },
  );

  app.post(
    '/admin/assets/pose-assets/:id/presign-bgcomfy',
    { preHandler: W, schema: { params: uuidParam, body: z.object({ contentType: z.string() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { contentType } = req.body as { contentType: string };
      const r2Key = keys.modelPoseBgComfy(id);
      const res = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      return { r2Key, uploadUrl: res.url };
    },
  );

  // Edit pose asset
  app.patch(
    '/admin/assets/pose-assets/:id',
    {
      preHandler: W,
      schema: {
        params: uuidParam,
        body: z.object({
          label: z.string().min(1).optional(),
          displayName: z.string().nullable().optional(),
          genderSlug: z.string().nullable().optional(),
          r2Key: z.string().optional(),
          thumbnailKey: z.string().optional(),
          faceSideR2Key: z.string().nullable().optional(),
          bgComfyR2Key: z.string().nullable().optional(),
          faceId: z.string().uuid().nullable().optional(),
          backgroundId: z.string().uuid().nullable().optional(),
          workflowTemplateId: z.string().uuid().nullable().optional(),
          promptGarmentPhase: z.string().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        label?: string;
        displayName?: string | null;
        genderSlug?: string | null;
        r2Key?: string;
        thumbnailKey?: string;
        faceSideR2Key?: string | null;
        bgComfyR2Key?: string | null;
        faceId?: string | null;
        backgroundId?: string | null;
        workflowTemplateId?: string | null;
        promptGarmentPhase?: string | null;
      };
      // Validate FK references before update
      if (body.backgroundId) {
        const [bg] = await app.db
          .select({ id: schema.modelBackgrounds.id })
          .from(schema.modelBackgrounds)
          .where(eq(schema.modelBackgrounds.id, body.backgroundId));
        if (!bg) throw new AppError('NOT_FOUND', 404, `background not found: ${body.backgroundId}`);
      }
      if (body.faceId) {
        const [face] = await app.db
          .select({ id: schema.modelFaces.id })
          .from(schema.modelFaces)
          .where(eq(schema.modelFaces.id, body.faceId));
        if (!face) throw new AppError('NOT_FOUND', 404, `face not found: ${body.faceId}`);
      }

      const set: Record<string, unknown> = {};
      if (body.label !== undefined) set.label = body.label;
      if (body.displayName !== undefined) set.displayName = body.displayName;
      if (body.genderSlug !== undefined) set.genderSlug = body.genderSlug;
      if (body.r2Key !== undefined) set.r2Key = body.r2Key;
      if (body.thumbnailKey !== undefined) set.thumbnailKey = body.thumbnailKey;
      if (body.faceSideR2Key !== undefined) set.faceSideR2Key = body.faceSideR2Key;
      if (body.bgComfyR2Key !== undefined) set.bgComfyR2Key = body.bgComfyR2Key;
      if (body.faceId !== undefined) set.faceId = body.faceId;
      if (body.backgroundId !== undefined) set.backgroundId = body.backgroundId;
      if (body.workflowTemplateId !== undefined) set.workflowTemplateId = body.workflowTemplateId;
      if (body.promptGarmentPhase !== undefined)
        set.promptGarmentPhase = body.promptGarmentPhase || null;
      const [updated] = await app.db
        .update(schema.modelPoseAssets)
        .set(set)
        .where(eq(schema.modelPoseAssets.id, id))
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'pose asset not found');
      return updated;
    },
  );

  // Map a pose asset to a garment type (creates model_poses row)
  // face/bg/workflow are optional — defaults to values stored on the pose asset itself
  app.post(
    '/admin/assets/pose-assets/:id/map',
    {
      preHandler: W,
      schema: {
        params: uuidParam,
        body: z.object({
          garmentTypeId: z.string().uuid(),
          faceId: z.string().uuid().optional(),
          backgroundId: z.string().uuid().optional(),
          workflowTemplateId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        garmentTypeId: string;
        faceId?: string;
        backgroundId?: string;
        workflowTemplateId?: string;
      };

      const [asset] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, id));
      if (!asset) throw new AppError('NOT_FOUND', 404, 'pose asset not found');

      const resolvedFaceId = body.faceId ?? asset.faceId;
      const resolvedBgId = body.backgroundId ?? asset.backgroundId;
      const resolvedWfId = body.workflowTemplateId ?? asset.workflowTemplateId;

      if (!resolvedFaceId)
        throw new AppError('VALIDATION', 400, 'faceId required — set it on the pose asset first');
      if (!resolvedBgId)
        throw new AppError(
          'VALIDATION',
          400,
          'backgroundId required — set it on the pose asset first',
        );
      if (!resolvedWfId)
        throw new AppError(
          'VALIDATION',
          400,
          'workflowTemplateId required — set it on the pose asset first',
        );

      const [wf] = await app.db
        .select({
          id: schema.workflowTemplates.id,
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
        })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, resolvedWfId));
      if (!wf) throw new AppError('NOT_FOUND', 404, 'workflow template not found');

      const [mapping] = await app.db
        .insert(schema.modelPoses)
        .values({
          subcategoryId: body.garmentTypeId,
          faceId: resolvedFaceId,
          backgroundId: resolvedBgId,
          workflowTemplateId: resolvedWfId,
          poseAssetId: asset.id,
          label: asset.displayName ?? asset.label,
          r2Key: asset.r2Key,
          thumbnailKey: asset.thumbnailKey,
          faceSideR2Key: asset.faceSideR2Key,
          bgComfyR2Key: asset.bgComfyR2Key,
          showsLower: Boolean(wf.lowerNodeId),
          showsShoes: Boolean(wf.shoeNodeId),
          sortOrder: 0,
        })
        .returning();
      return mapping;
    },
  );

  // Bulk-map many pose assets to one garment type in a single transaction
  app.post(
    '/admin/assets/pose-assets/bulk-map',
    {
      preHandler: W,
      schema: {
        body: z.object({
          assetIds: z.array(z.string().uuid()).min(1).max(2000),
          garmentTypeId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      const { assetIds, garmentTypeId } = req.body as {
        assetIds: string[];
        garmentTypeId: string;
      };

      // Fetch all requested assets in one query
      const assets = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(inArray(schema.modelPoseAssets.id, assetIds));

      if (assets.length === 0) return { created: 0, skipped: 0, errors: [] };

      // Collect unique workflow IDs to fetch showsLower/showsShoes flags
      const wfIds = [
        ...new Set(assets.map((a) => a.workflowTemplateId).filter(Boolean) as string[]),
      ];
      const wfRows = wfIds.length
        ? await app.db
            .select({
              id: schema.workflowTemplates.id,
              lowerNodeId: schema.workflowTemplates.lowerNodeId,
              shoeNodeId: schema.workflowTemplates.shoeNodeId,
            })
            .from(schema.workflowTemplates)
            .where(inArray(schema.workflowTemplates.id, wfIds))
        : [];
      const wfMap = new Map(wfRows.map((w) => [w.id, w]));

      // Find already-mapped asset IDs for this garment type (skip duplicates)
      const existingRows = await app.db
        .select({ poseAssetId: schema.modelPoses.poseAssetId })
        .from(schema.modelPoses)
        .where(
          and(
            eq(schema.modelPoses.subcategoryId, garmentTypeId),
            inArray(
              schema.modelPoses.poseAssetId,
              assets.map((a) => a.id),
            ),
          ),
        );
      const alreadyMapped = new Set(
        existingRows.map((r) => r.poseAssetId).filter(Boolean) as string[],
      );

      const errors: string[] = [];
      const rows = assets
        .filter((a) => {
          if (alreadyMapped.has(a.id)) return false;
          if (!a.faceId) {
            errors.push(`${a.id}: missing faceId`);
            return false;
          }
          if (!a.backgroundId) {
            errors.push(`${a.id}: missing backgroundId`);
            return false;
          }
          if (!a.workflowTemplateId) {
            errors.push(`${a.id}: missing workflowTemplateId`);
            return false;
          }
          if (!wfMap.has(a.workflowTemplateId)) {
            errors.push(`${a.id}: workflow not found`);
            return false;
          }
          return true;
        })
        .map((a) => {
          const wf = wfMap.get(a.workflowTemplateId!)!;
          return {
            subcategoryId: garmentTypeId,
            faceId: a.faceId!,
            backgroundId: a.backgroundId!,
            workflowTemplateId: a.workflowTemplateId!,
            poseAssetId: a.id,
            label: a.displayName ?? a.label,
            r2Key: a.r2Key,
            thumbnailKey: a.thumbnailKey,
            faceSideR2Key: a.faceSideR2Key,
            bgComfyR2Key: a.bgComfyR2Key,
            showsLower: Boolean(wf.lowerNodeId),
            showsShoes: Boolean(wf.shoeNodeId),
            sortOrder: 0,
          };
        });

      const skipped = alreadyMapped.size;
      if (rows.length === 0) return { created: 0, skipped, errors };

      // Insert all rows in one statement (chunk to stay under Postgres param limit)
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await app.db.insert(schema.modelPoses).values(rows.slice(i, i + CHUNK));
      }

      return { created: rows.length, skipped, errors };
    },
  );

  // List garment-type mappings for a pose asset
  app.get(
    '/admin/assets/pose-assets/:id/mappings',
    { preHandler: W, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const rows = await app.db
        .select({
          id: schema.modelPoses.id,
          garmentTypeId: schema.modelPoses.subcategoryId,
          garmentTypeLabel: schema.garmentSubcategories.label,
          faceId: schema.modelPoses.faceId,
          faceLabel: schema.modelFaces.label,
          backgroundId: schema.modelPoses.backgroundId,
          backgroundLabel: schema.modelBackgrounds.label,
          workflowTemplateId: schema.modelPoses.workflowTemplateId,
          workflowLabel: schema.workflowTemplates.label,
          isActive: schema.modelPoses.isActive,
          createdAt: schema.modelPoses.createdAt,
        })
        .from(schema.modelPoses)
        .leftJoin(
          schema.garmentSubcategories,
          eq(schema.modelPoses.subcategoryId, schema.garmentSubcategories.id),
        )
        .leftJoin(schema.modelFaces, eq(schema.modelPoses.faceId, schema.modelFaces.id))
        .leftJoin(
          schema.modelBackgrounds,
          eq(schema.modelPoses.backgroundId, schema.modelBackgrounds.id),
        )
        .leftJoin(
          schema.workflowTemplates,
          eq(schema.modelPoses.workflowTemplateId, schema.workflowTemplates.id),
        )
        .where(eq(schema.modelPoses.poseAssetId, id))
        .orderBy(schema.modelPoses.createdAt);
      return { items: rows };
    },
  );

  app.delete(
    '/admin/assets/pose-assets/:id',
    {
      preHandler: W,
      schema: {
        params: uuidParam,
        querystring: z.object({ force: z.coerce.boolean().optional().default(false) }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { force } = req.query as { force: boolean };
      const [asset] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, id));
      if (!asset) throw new AppError('NOT_FOUND', 404, 'pose asset not found');

      const mappings = await app.db
        .select({ id: schema.modelPoses.id })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.poseAssetId, id));

      if (mappings.length > 0 && !force) {
        throw new AppError(
          'CONFLICT',
          409,
          `pose asset has ${mappings.length} garment-type mapping(s) — delete with ?force=true to also remove mappings`,
        );
      }

      if (mappings.length > 0 && force) {
        const mappingIds = mappings.map((m) => m.id);
        // Remove job refs first
        const jobRefs = await app.db
          .select({ jobId: schema.jobInputs.jobId })
          .from(schema.jobInputs)
          .where(inArray(schema.jobInputs.poseId, mappingIds));
        if (jobRefs.length > 0) {
          const jobIds = [...new Set(jobRefs.map((r) => r.jobId))];
          await app.db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
        }
        await app.db.delete(schema.modelPoses).where(inArray(schema.modelPoses.id, mappingIds));
      }

      const keysToDelete = [asset.r2Key, asset.thumbnailKey];
      if (asset.faceSideR2Key && asset.faceSideR2Key !== asset.r2Key)
        keysToDelete.push(asset.faceSideR2Key);
      if (asset.bgComfyR2Key && asset.bgComfyR2Key !== asset.r2Key)
        keysToDelete.push(asset.bgComfyR2Key);

      await app.db.delete(schema.modelPoseAssets).where(eq(schema.modelPoseAssets.id, id));
      void Promise.allSettled(keysToDelete.map((k) => app.storage.deleteObject(k)));
      return { ok: true };
    },
  );

  // Bulk delete pose assets (force — removes mappings + jobs + R2)
  app.delete(
    '/admin/assets/pose-assets',
    {
      preHandler: W,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };

      const assets = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(inArray(schema.modelPoseAssets.id, ids));

      const mappings = await app.db
        .select({ id: schema.modelPoses.id })
        .from(schema.modelPoses)
        .where(inArray(schema.modelPoses.poseAssetId, ids));

      if (mappings.length > 0) {
        const mappingIds = mappings.map((m) => m.id);
        const jobRefs = await app.db
          .select({ jobId: schema.jobInputs.jobId })
          .from(schema.jobInputs)
          .where(inArray(schema.jobInputs.poseId, mappingIds));
        if (jobRefs.length > 0) {
          const jobIds = [...new Set(jobRefs.map((r) => r.jobId))];
          await app.db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
        }
        await app.db.delete(schema.modelPoses).where(inArray(schema.modelPoses.id, mappingIds));
      }

      await app.db.delete(schema.modelPoseAssets).where(inArray(schema.modelPoseAssets.id, ids));

      const r2Keys = assets.flatMap((a) => {
        const ks = [a.r2Key, a.thumbnailKey];
        if (a.faceSideR2Key && a.faceSideR2Key !== a.r2Key) ks.push(a.faceSideR2Key);
        if (a.bgComfyR2Key && a.bgComfyR2Key !== a.r2Key) ks.push(a.bgComfyR2Key);
        return ks;
      });
      void Promise.allSettled(r2Keys.map((k) => app.storage.deleteObject(k)));

      return { deleted: assets.length };
    },
  );

  async function makeThumb(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
  }

  // ── Bulk import from ZIP ──────────────────────────────────────────────────
  app.post('/admin/assets/bulk-import', { preHandler: W }, async (req) => {
    const data = await req.file();
    if (!data) throw new AppError('VALIDATION', 400, 'no file uploaded');

    // Read metadata fields from form
    const fields = data.fields as Record<string, { value?: string }>;
    const workflowTemplateId = fields['workflowTemplateId']?.value ?? null;
    const genderSlug = fields['genderSlug']?.value ?? 'men';

    if (workflowTemplateId) {
      const [wf] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, workflowTemplateId));
      if (!wf) throw new AppError('NOT_FOUND', 404, 'workflow template not found');
    }

    // Buffer the ZIP
    const zipBuffer = await data.toBuffer();
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const extToMime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };

    const isImageEntry = (name: string) =>
      imageExts.has(name.slice(name.lastIndexOf('.')).toLowerCase());

    // Separate entries by folder type
    const bgEntries = entries.filter(
      (e) => /backgrounds?/i.test(e.entryName) && isImageEntry(e.name),
    );
    const faceEntries = entries.filter(
      (e) => /faces?/i.test(e.entryName) && !/poses?/i.test(e.entryName) && isImageEntry(e.name),
    );
    const poseEntries = entries.filter((e) => /poses?/i.test(e.entryName) && isImageEntry(e.name));

    const errors: string[] = [];
    let createdFaces = 0;
    let createdBackgrounds = 0;
    let createdPoses = 0;

    // Upload backgrounds — index by filename stem (bg1 → 1)
    const bgIndexMap = new Map<number, { id: string; r2Key: string }>(); // bgNumber → { id, r2Key }
    for (const entry of bgEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        const numMatch = stem.match(/(\d+)$/);
        const bgNum = numMatch ? parseInt(numMatch[1], 10) : bgEntries.indexOf(entry) + 1;
        // Skip if already exists (same label + gender)
        const [existing] = await app.db
          .select({ id: schema.modelBackgrounds.id, r2Key: schema.modelBackgrounds.r2Key })
          .from(schema.modelBackgrounds)
          .where(
            and(
              eq(schema.modelBackgrounds.label, stem),
              eq(schema.modelBackgrounds.genderSlug, genderSlug),
            ),
          );
        if (existing) {
          bgIndexMap.set(bgNum, { id: existing.id, r2Key: existing.r2Key });
          continue;
        }
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        const mime = extToMime[ext] ?? 'image/jpeg';
        const id = randomUUID();
        const r2Key = keys.modelBackground(id);
        const thumbKey = keys.modelBackgroundThumb(id);
        const buf = entry.getData();
        const thumb = await makeThumb(buf);
        await Promise.all([
          app.storage.putObject(r2Key, buf, mime),
          app.storage.putObject(thumbKey, thumb, 'image/jpeg'),
        ]);
        const [row] = await app.db
          .insert(schema.modelBackgrounds)
          .values({ label: stem, r2Key, thumbnailKey: thumbKey, genderSlug, sortOrder: bgNum })
          .returning({ id: schema.modelBackgrounds.id });
        bgIndexMap.set(bgNum, { id: row.id, r2Key });
        createdBackgrounds++;
      } catch (err) {
        errors.push(`bg ${entry.name}: ${(err as Error).message}`);
      }
    }

    // Upload faces — index by filename number (face01 → 1)
    const faceIndexMap = new Map<number, { id: string; r2Key: string }>(); // faceNumber → { id, r2Key }
    for (const entry of faceEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        const numMatch = stem.match(/(\d+)$/);
        const faceNum = numMatch ? parseInt(numMatch[1], 10) : faceEntries.indexOf(entry) + 1;
        // Skip if already exists (same label + gender)
        const [existing] = await app.db
          .select({ id: schema.modelFaces.id, r2Key: schema.modelFaces.r2Key })
          .from(schema.modelFaces)
          .where(and(eq(schema.modelFaces.label, stem), eq(schema.modelFaces.gender, genderSlug)));
        if (existing) {
          faceIndexMap.set(faceNum, { id: existing.id, r2Key: existing.r2Key });
          continue;
        }
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        const mime = extToMime[ext] ?? 'image/jpeg';
        const id = randomUUID();
        const r2Key = keys.modelFace(id);
        const thumbKey = keys.modelFaceThumb(id);
        const buf = entry.getData();
        const thumb = await makeThumb(buf);
        await Promise.all([
          app.storage.putObject(r2Key, buf, mime),
          app.storage.putObject(thumbKey, thumb, 'image/jpeg'),
        ]);
        const [row] = await app.db
          .insert(schema.modelFaces)
          .values({
            label: stem,
            gender: genderSlug,
            r2Key,
            thumbnailKey: thumbKey,
            sortOrder: faceNum,
          })
          .returning({ id: schema.modelFaces.id });
        faceIndexMap.set(faceNum, { id: row.id, r2Key });
        createdFaces++;
      } catch (err) {
        errors.push(`face ${entry.name}: ${(err as Error).message}`);
      }
    }

    // Upload poses — parse faceXXbgYposeZZ pattern
    const posePattern = /face(\d+)bg(\d+)pose(\d+)/i;
    let sortOrder = 0;
    for (const entry of poseEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        const m = stem.match(posePattern);
        if (!m) {
          errors.push(`pose ${entry.name}: filename doesn't match faceXXbgYposeZZ`);
          continue;
        }
        const faceNum = parseInt(m[1], 10);
        const bgNum = parseInt(m[2], 10);
        let faceEntry = faceIndexMap.get(faceNum);
        let bgEntry = bgIndexMap.get(bgNum);

        // Fall back to DB lookup if face not in ZIP batch
        if (!faceEntry) {
          const [dbFace] = await app.db
            .select({ id: schema.modelFaces.id, r2Key: schema.modelFaces.r2Key })
            .from(schema.modelFaces)
            .where(
              and(
                eq(schema.modelFaces.gender, genderSlug),
                eq(schema.modelFaces.sortOrder, faceNum),
              ),
            );
          if (dbFace) {
            faceEntry = { id: dbFace.id, r2Key: dbFace.r2Key };
            faceIndexMap.set(faceNum, faceEntry);
          }
        }
        // Fall back to DB lookup if background not in ZIP batch
        if (!bgEntry) {
          const [dbBg] = await app.db
            .select({ id: schema.modelBackgrounds.id, r2Key: schema.modelBackgrounds.r2Key })
            .from(schema.modelBackgrounds)
            .where(
              and(
                eq(schema.modelBackgrounds.genderSlug, genderSlug),
                eq(schema.modelBackgrounds.sortOrder, bgNum),
              ),
            );
          if (dbBg) {
            bgEntry = { id: dbBg.id, r2Key: dbBg.r2Key };
            bgIndexMap.set(bgNum, bgEntry);
          }
        }

        if (!faceEntry) {
          errors.push(
            `pose ${entry.name}: face${m[1]} not found in ZIP or DB (gender=${genderSlug}, sortOrder=${faceNum})`,
          );
          continue;
        }
        if (!bgEntry) {
          errors.push(
            `pose ${entry.name}: bg${m[2]} not found in ZIP or DB (gender=${genderSlug}, sortOrder=${bgNum})`,
          );
          continue;
        }
        // Dedup by label + gender: skip create but patch null FK/key fields
        const [existingAsset] = await app.db
          .select({
            id: schema.modelPoseAssets.id,
            faceId: schema.modelPoseAssets.faceId,
            backgroundId: schema.modelPoseAssets.backgroundId,
            faceSideR2Key: schema.modelPoseAssets.faceSideR2Key,
            bgComfyR2Key: schema.modelPoseAssets.bgComfyR2Key,
          })
          .from(schema.modelPoseAssets)
          .where(
            and(
              eq(schema.modelPoseAssets.label, stem),
              eq(schema.modelPoseAssets.genderSlug, genderSlug),
            ),
          );
        if (existingAsset) {
          // Backfill null FK/key columns that were absent on original import
          const patch: Record<string, unknown> = {};
          if (!existingAsset.faceId) patch.faceId = faceEntry.id;
          if (!existingAsset.backgroundId) patch.backgroundId = bgEntry.id;
          if (!existingAsset.faceSideR2Key) patch.faceSideR2Key = faceEntry.r2Key;
          if (!existingAsset.bgComfyR2Key) patch.bgComfyR2Key = bgEntry.r2Key;
          if (Object.keys(patch).length > 0) {
            await app.db
              .update(schema.modelPoseAssets)
              .set(patch)
              .where(eq(schema.modelPoseAssets.id, existingAsset.id));
          }
          sortOrder++;
          continue;
        }
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        const mime = extToMime[ext] ?? 'image/png';
        const id = randomUUID();
        const r2Key = keys.modelPose(id);
        const thumbKey = keys.modelPoseThumb(id);
        const buf = entry.getData();
        const thumb = await makeThumb(buf);
        await Promise.all([
          app.storage.putObject(r2Key, buf, mime),
          app.storage.putObject(thumbKey, thumb, 'image/jpeg'),
        ]);
        await app.db.insert(schema.modelPoseAssets).values({
          label: stem,
          r2Key,
          thumbnailKey: thumbKey,
          faceSideR2Key: faceEntry.r2Key,
          bgComfyR2Key: bgEntry.r2Key,
          faceId: faceEntry.id,
          backgroundId: bgEntry.id,
          workflowTemplateId: workflowTemplateId ?? null,
          genderSlug,
        });
        sortOrder++;
        createdPoses++;
      } catch (err) {
        errors.push(`pose ${entry.name}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      app.log.warn(
        { errors: errors.slice(0, 5), total: errors.length },
        'bulk-import partial errors',
      );
    }
    return {
      created: { faces: createdFaces, backgrounds: createdBackgrounds, poses: createdPoses },
      errors,
    };
  });
}
