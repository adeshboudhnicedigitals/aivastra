import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  AssetContentType,
  ConfirmModelBackgroundBody,
  ConfirmModelFaceBody,
  PatchModelBackgroundBody,
  PatchModelFaceBody,
  PresignModelBackgroundBody,
  PresignModelFaceBody,
} from '@aivastra/types';
import AdmZip from 'adm-zip';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminAssetsRoutes(app: FastifyInstance) {
  const RW = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
  const D = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // ── Faces ─────────────────────────────────────────────────────────────────

  app.get('/admin/assets/faces', { preHandler: RW }, async () => {
    const rows = await app.db
      .select()
      .from(schema.modelFaces)
      .where(isNull(schema.modelFaces.deletedAt));
    return { items: rows };
  });

  app.post(
    '/admin/assets/faces/presign',
    {
      preHandler: RW,
      schema: { body: PresignModelFaceBody },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const newId = randomUUID();
      const r2Key = keys.modelFace(newId);
      const thumbKey = keys.modelFaceThumb(newId);
      const faceSideKey = keys.modelFaceSide(newId);
      const [main, thumb, faceSide] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
        app.storage.presignPut(faceSideKey, 'image/jpeg', 10_000_000, 300),
      ]);
      return {
        uploadUrl: main.url,
        r2Key,
        thumbnailUploadUrl: thumb.url,
        thumbnailKey: thumbKey,
        faceSideUploadUrl: faceSide.url,
        faceSideR2Key: faceSideKey,
      };
    },
  );

  app.post(
    '/admin/assets/faces/confirm',
    {
      preHandler: RW,
      schema: { body: ConfirmModelFaceBody },
    },
    async (req) => {
      const { label, gender, r2Key, thumbnailKey, faceSideR2Key, sortOrder } = req.body as {
        label: string;
        gender: string;
        r2Key: string;
        thumbnailKey: string;
        faceSideR2Key?: string;
        sortOrder: number;
      };
      const [row] = await app.db
        .insert(schema.modelFaces)
        .values({
          label,
          gender,
          r2Key,
          thumbnailKey,
          faceSideR2Key: faceSideR2Key ?? null,
          sortOrder,
        })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/faces/:id',
    {
      preHandler: RW,
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

  app.post(
    '/admin/assets/faces/:id/presign-side',
    {
      preHandler: RW,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const faceSideKey = keys.modelFaceSide(id);
      const presign = await app.storage.presignPut(faceSideKey, 'image/jpeg', 10_000_000, 300);
      return { uploadUrl: presign.url, faceSideR2Key: faceSideKey };
    },
  );

  app.delete(
    '/admin/assets/faces/:id',
    {
      preHandler: D,
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

      await app.db
        .update(schema.modelFaces)
        .set({ deletedAt: new Date() })
        .where(eq(schema.modelFaces.id, id));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/faces',
    {
      preHandler: D,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      await app.db
        .update(schema.modelFaces)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.modelFaces.id, ids));
      return { deleted: ids.length };
    },
  );

  // ── Backgrounds (global) ──────────────────────────────────────────────────

  app.get(
    '/admin/assets/backgrounds',
    {
      preHandler: RW,
      schema: {
        querystring: z.object({
          genderSlug: z.string().optional(),
          categoryId: z.coerce.number().int().optional(),
          uncategorized: z.coerce.boolean().optional(),
          // Default excludes template-scoped rows (they're managed only via the
          // catalogue template that owns them) — pass scope=all to include them,
          // e.g. for the Catalogue Templates tab's look-thumbnail lookups.
          scope: z.enum(['general', 'template', 'all']).optional(),
        }),
      },
    },
    async (req) => {
      const { genderSlug, categoryId, uncategorized, scope } = req.query as {
        genderSlug?: string;
        categoryId?: number;
        uncategorized?: boolean;
        scope?: 'general' | 'template' | 'all';
      };
      const rows = await app.db
        .select()
        .from(schema.modelBackgrounds)
        .where(
          and(
            isNull(schema.modelBackgrounds.deletedAt),
            genderSlug ? eq(schema.modelBackgrounds.genderSlug, genderSlug) : undefined,
            categoryId ? eq(schema.modelBackgrounds.categoryId, categoryId) : undefined,
            uncategorized ? isNull(schema.modelBackgrounds.categoryId) : undefined,
            scope === 'all' ? undefined : eq(schema.modelBackgrounds.scope, scope ?? 'general'),
          ),
        );
      return { items: rows };
    },
  );

  app.post(
    '/admin/assets/backgrounds/presign',
    {
      preHandler: RW,
      schema: { body: PresignModelBackgroundBody },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const newId = randomUUID();
      const r2Key = keys.modelBackground(newId);
      const main = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      return {
        uploadUrl: main.url,
        r2Key,
      };
    },
  );

  app.post(
    '/admin/assets/backgrounds/confirm',
    {
      preHandler: RW,
      schema: { body: ConfirmModelBackgroundBody },
    },
    async (req) => {
      const body = req.body as {
        label: string;
        r2Key: string;
        bgComfyR2Key?: string;
        sortOrder: number;
        genderSlug?: string;
        isWhiteBg?: boolean;
        categoryId?: number | null;
        tags?: string[];
        specialTag?: string | null;
        scope?: 'general' | 'template';
      };
      // If marking this background as white, unset all other backgrounds' isWhiteBg first
      if (body.isWhiteBg) {
        await app.db
          .update(schema.modelBackgrounds)
          .set({ isWhiteBg: false })
          .where(eq(schema.modelBackgrounds.isWhiteBg, true));
      }
      // Auto-generate the thumbnail server-side from the already-uploaded display image
      // instead of trusting a client-supplied thumbnail.
      const thumbnailKey = body.r2Key.replace(/\.jpg$/, '.thumb.jpg');
      const buf = await app.storage.getObject(body.r2Key);
      const thumb = await makeThumb(buf);
      await app.storage.putObject(thumbnailKey, thumb, 'image/jpeg');
      const [row] = await app.db
        .insert(schema.modelBackgrounds)
        .values({
          label: body.label,
          r2Key: body.r2Key,
          thumbnailKey,
          bgComfyR2Key: body.bgComfyR2Key ?? null,
          sortOrder: body.sortOrder,
          genderSlug: body.genderSlug ?? null,
          isWhiteBg: body.isWhiteBg ?? false,
          categoryId: body.categoryId ?? null,
          tags: body.tags ?? [],
          specialTag: body.specialTag ?? null,
          scope: body.scope ?? 'general',
        })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/backgrounds/:id',
    {
      preHandler: RW,
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
      // If the display image is being replaced, regenerate the thumbnail server-side
      // from the new image instead of trusting a client-supplied thumbnail.
      if (typeof body.r2Key === 'string') {
        const thumbnailKey = body.r2Key.replace(/\.jpg$/, '.thumb.jpg');
        const buf = await app.storage.getObject(body.r2Key);
        const thumb = await makeThumb(buf);
        await app.storage.putObject(thumbnailKey, thumb, 'image/jpeg');
        body.thumbnailKey = thumbnailKey;
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
      preHandler: D,
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

      await app.db
        .update(schema.modelBackgrounds)
        .set({ deletedAt: new Date() })
        .where(eq(schema.modelBackgrounds.id, id));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/backgrounds',
    {
      preHandler: D,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      await app.db
        .update(schema.modelBackgrounds)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.modelBackgrounds.id, ids));
      return { deleted: ids.length };
    },
  );

  app.patch(
    '/admin/assets/backgrounds/bulk',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          ids: z.array(z.string().uuid()).min(1),
          categoryId: z.number().int().positive().nullable().optional(),
          genderSlug: z.enum(['men', 'women', 'boys', 'girls']).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { ids, categoryId, genderSlug } = req.body as {
        ids: string[];
        categoryId?: number | null;
        genderSlug?: string | null;
      };
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (categoryId !== undefined) patch.categoryId = categoryId;
      if (genderSlug !== undefined) patch.genderSlug = genderSlug;
      // isWhiteBg is intentionally excluded — it must stay unique across all backgrounds.
      await app.db
        .update(schema.modelBackgrounds)
        .set(patch)
        .where(inArray(schema.modelBackgrounds.id, ids));
      return { updated: ids.length };
    },
  );

  // (model_poses routes removed — pose-assets is the single source of truth)

  // ── Pose Assets (centralised R2 object management) ───────────────────────

  app.get(
    '/admin/assets/pose-assets',
    {
      preHandler: RW,
      schema: {
        querystring: z.object({
          // Default excludes template-scoped rows (they're managed only via the
          // catalogue template that owns them) — pass scope=all to include them,
          // e.g. for the Catalogue Templates tab's look-thumbnail lookups.
          scope: z.enum(['general', 'template', 'all']).optional(),
        }),
      },
    },
    async (req) => {
      const { scope } = req.query as { scope?: 'general' | 'template' | 'all' };
      const rows = await app.db
        .select({
          id: schema.modelPoseAssets.id,
          label: schema.modelPoseAssets.label,
          r2Key: schema.modelPoseAssets.r2Key,
          thumbnailKey: schema.modelPoseAssets.thumbnailKey,
          genderSlug: schema.modelPoseAssets.genderSlug,
          workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
          promptGarmentPhase: schema.modelPoseAssets.promptGarmentPhase,
          promptFacePhase: schema.modelPoseAssets.promptFacePhase,
          poseVariant: schema.modelPoseAssets.poseVariant,
          displayName: schema.modelPoseAssets.displayName,
          isActive: schema.modelPoseAssets.isActive,
          sortOrder: schema.modelPoseAssets.sortOrder,
          createdAt: schema.modelPoseAssets.createdAt,
        })
        .from(schema.modelPoseAssets)
        .where(
          and(
            isNull(schema.modelPoseAssets.deletedAt),
            scope === 'all' ? undefined : eq(schema.modelPoseAssets.scope, scope ?? 'general'),
          ),
        )
        .orderBy(schema.modelPoseAssets.sortOrder, schema.modelPoseAssets.label);
      return { items: rows };
    },
  );

  // Presign for a new pose asset image upload
  app.post(
    '/admin/assets/pose-assets/presign',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          contentType: AssetContentType,
        }),
      },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const newId = randomUUID();
      const r2Key = keys.modelPose(newId);
      const thumbKey = keys.modelPoseThumb(newId);

      const [mainRes, thumbRes] = await Promise.all([
        app.storage.presignPut(r2Key, contentType, 10_000_000, 300),
        app.storage.presignPut(thumbKey, 'image/jpeg', 1_000_000, 300),
      ]);

      return {
        r2Key,
        uploadUrl: mainRes.url,
        thumbnailKey: thumbKey,
        thumbnailUploadUrl: thumbRes.url,
      };
    },
  );

  // Confirm / create pose asset row after upload
  app.post(
    '/admin/assets/pose-assets',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          label: z.string().min(1),
          displayName: z.string().optional(),
          genderSlug: z.string().optional(),
          r2Key: z.string(),
          thumbnailKey: z.string(),
          workflowTemplateId: z.string().uuid().optional(),
          promptGarmentPhase: z.string().optional(),
          promptFacePhase: z.string().optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
          // 'template' = uploaded from a catalogue template's looks builder — hidden
          // from the admin Pose Assets tab and studio "create your own look".
          scope: z.enum(['general', 'template']).optional(),
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
        workflowTemplateId?: string;
        promptGarmentPhase?: string;
        promptFacePhase?: string;
        isActive?: boolean;
        sortOrder?: number;
        scope?: 'general' | 'template';
      };

      const [inserted] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: body.label,
          displayName: body.displayName ?? null,
          genderSlug: body.genderSlug ?? null,
          r2Key: body.r2Key,
          thumbnailKey: body.thumbnailKey,
          workflowTemplateId: body.workflowTemplateId ?? null,
          promptGarmentPhase: body.promptGarmentPhase ?? null,
          promptFacePhase: body.promptFacePhase ?? null,
          isActive: body.isActive ?? true,
          sortOrder: body.sortOrder ?? 0,
          scope: body.scope ?? 'general',
        })
        .returning();

      return inserted;
    },
  );

  // Presign pose-asset image replacements
  app.post(
    '/admin/assets/pose-assets/:id/presign-pose',
    { preHandler: RW, schema: { params: uuidParam, body: z.object({ contentType: z.string() }) } },
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

  // Edit pose asset
  app.patch(
    '/admin/assets/pose-assets/:id',
    {
      preHandler: RW,
      schema: {
        params: uuidParam,
        body: z.object({
          label: z.string().min(1).optional(),
          displayName: z.string().nullable().optional(),
          genderSlug: z.string().nullable().optional(),
          r2Key: z.string().optional(),
          thumbnailKey: z.string().optional(),
          workflowTemplateId: z.string().uuid().nullable().optional(),
          promptGarmentPhase: z.string().nullable().optional(),
          promptFacePhase: z.string().nullable().optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
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
        workflowTemplateId?: string | null;
        promptGarmentPhase?: string | null;
        promptFacePhase?: string | null;
        isActive?: boolean;
        sortOrder?: number;
      };

      const set: Record<string, unknown> = {};
      if (body.label !== undefined) set.label = body.label;
      if (body.displayName !== undefined) set.displayName = body.displayName;
      if (body.genderSlug !== undefined) set.genderSlug = body.genderSlug;
      if (body.r2Key !== undefined) set.r2Key = body.r2Key;
      if (body.thumbnailKey !== undefined) set.thumbnailKey = body.thumbnailKey;
      if (body.workflowTemplateId !== undefined) set.workflowTemplateId = body.workflowTemplateId;
      if (body.promptGarmentPhase !== undefined)
        set.promptGarmentPhase = body.promptGarmentPhase || null;
      if (body.promptFacePhase !== undefined) set.promptFacePhase = body.promptFacePhase || null;
      if (body.isActive !== undefined) set.isActive = body.isActive;
      if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;

      const [updated] = await app.db
        .update(schema.modelPoseAssets)
        .set(set)
        .where(eq(schema.modelPoseAssets.id, id))
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'pose asset not found');

      return updated;
    },
  );

  app.delete(
    '/admin/assets/pose-assets/:id',
    {
      preHandler: RW,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [asset] = await app.db
        .select({ id: schema.modelPoseAssets.id })
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, id));
      if (!asset) throw new AppError('NOT_FOUND', 404, 'pose asset not found');

      // Check if any jobs reference this pose asset
      const jobRefs = await app.db
        .select({ jobId: schema.jobInputs.jobId })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.poseId, id))
        .limit(1);
      if (jobRefs.length > 0) {
        throw new AppError(
          'CONFLICT',
          409,
          'pose asset is referenced by existing jobs — cannot delete',
        );
      }

      // Soft delete — keep R2 intact for potential restore
      await app.db
        .update(schema.modelPoseAssets)
        .set({ deletedAt: new Date() })
        .where(eq(schema.modelPoseAssets.id, id));
      return { ok: true };
    },
  );

  // Bulk soft-delete pose assets
  app.delete(
    '/admin/assets/pose-assets',
    {
      preHandler: RW,
      schema: { body: z.object({ ids: z.array(z.string().uuid()).min(1) }) },
    },
    async (req) => {
      const { ids } = req.body as { ids: string[] };
      await app.db
        .update(schema.modelPoseAssets)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.modelPoseAssets.id, ids));
      return { deleted: ids.length };
    },
  );

  // Bulk set workflow template on pose assets
  app.patch(
    '/admin/assets/pose-assets/bulk-workflow',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          ids: z.array(z.string().uuid()).min(1),
          workflowTemplateId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      const { ids, workflowTemplateId } = req.body as {
        ids: string[];
        workflowTemplateId: string;
      };
      const [wf] = await app.db
        .select({
          id: schema.workflowTemplates.id,
          defaultGarmentPhasePrompt: schema.workflowTemplates.defaultGarmentPhasePrompt,
        })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, workflowTemplateId));
      if (!wf) throw new AppError('NOT_FOUND', 404, 'workflow template not found');
      await app.db
        .update(schema.modelPoseAssets)
        .set({ workflowTemplateId, promptGarmentPhase: wf.defaultGarmentPhasePrompt ?? null })
        .where(inArray(schema.modelPoseAssets.id, ids));
      return { updated: ids.length };
    },
  );

  // Bulk rename display name on pose assets
  app.patch(
    '/admin/assets/pose-assets/bulk-rename',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          ids: z.array(z.string().uuid()).min(1),
          displayName: z.string().min(1).max(200),
        }),
      },
    },
    async (req) => {
      const { ids, displayName } = req.body as { ids: string[]; displayName: string };
      await app.db
        .update(schema.modelPoseAssets)
        .set({ displayName })
        .where(inArray(schema.modelPoseAssets.id, ids));
      return { updated: ids.length };
    },
  );

  // ── Recycle bin ──────────────────────────────────────────────────────────

  app.get('/admin/assets/recycle-bin', { preHandler: RW }, async () => {
    const [faces, backgrounds, poseAssets] = await Promise.all([
      app.db
        .select()
        .from(schema.modelFaces)
        .where(sql`${schema.modelFaces.deletedAt} IS NOT NULL`)
        .orderBy(schema.modelFaces.deletedAt),
      app.db
        .select()
        .from(schema.modelBackgrounds)
        .where(sql`${schema.modelBackgrounds.deletedAt} IS NOT NULL`)
        .orderBy(schema.modelBackgrounds.deletedAt),
      app.db
        .select({
          id: schema.modelPoseAssets.id,
          label: schema.modelPoseAssets.label,
          displayName: schema.modelPoseAssets.displayName,
          r2Key: schema.modelPoseAssets.r2Key,
          thumbnailKey: schema.modelPoseAssets.thumbnailKey,
          genderSlug: schema.modelPoseAssets.genderSlug,
          poseVariant: schema.modelPoseAssets.poseVariant,
          deletedAt: schema.modelPoseAssets.deletedAt,
        })
        .from(schema.modelPoseAssets)
        .where(sql`${schema.modelPoseAssets.deletedAt} IS NOT NULL`)
        .orderBy(schema.modelPoseAssets.deletedAt),
    ]);
    return { faces, backgrounds, poseAssets };
  });

  app.post(
    '/admin/assets/recycle-bin/restore',
    {
      preHandler: RW,
      schema: {
        body: z.object({
          type: z.enum(['face', 'background', 'poseAsset']),
          ids: z.array(z.string().uuid()).min(1),
        }),
      },
    },
    async (req) => {
      const { type, ids } = req.body as {
        type: 'face' | 'background' | 'poseAsset';
        ids: string[];
      };
      if (type === 'face') {
        await app.db
          .update(schema.modelFaces)
          .set({ deletedAt: null })
          .where(inArray(schema.modelFaces.id, ids));
      } else if (type === 'background') {
        await app.db
          .update(schema.modelBackgrounds)
          .set({ deletedAt: null })
          .where(inArray(schema.modelBackgrounds.id, ids));
      } else {
        await app.db
          .update(schema.modelPoseAssets)
          .set({ deletedAt: null })
          .where(inArray(schema.modelPoseAssets.id, ids));
      }
      return { restored: ids.length };
    },
  );

  app.delete(
    '/admin/assets/recycle-bin',
    {
      preHandler: D,
      schema: {
        body: z.object({
          type: z.enum(['face', 'background', 'poseAsset']),
          ids: z.array(z.string().uuid()).min(1),
        }),
      },
    },
    async (req) => {
      const { type, ids } = req.body as {
        type: 'face' | 'background' | 'poseAsset';
        ids: string[];
      };
      if (type === 'face') {
        const rows = await app.db
          .select({ r2Key: schema.modelFaces.r2Key, thumbnailKey: schema.modelFaces.thumbnailKey })
          .from(schema.modelFaces)
          .where(inArray(schema.modelFaces.id, ids));
        await app.db.delete(schema.modelFaces).where(inArray(schema.modelFaces.id, ids));
        void Promise.allSettled(
          rows.flatMap((r) => [
            app.storage.deleteObject(r.r2Key),
            app.storage.deleteObject(r.thumbnailKey),
          ]),
        );
      } else if (type === 'background') {
        const rows = await app.db
          .select({
            r2Key: schema.modelBackgrounds.r2Key,
            thumbnailKey: schema.modelBackgrounds.thumbnailKey,
          })
          .from(schema.modelBackgrounds)
          .where(inArray(schema.modelBackgrounds.id, ids));
        await app.db
          .delete(schema.modelBackgrounds)
          .where(inArray(schema.modelBackgrounds.id, ids));
        void Promise.allSettled(
          rows.flatMap((r) => [
            app.storage.deleteObject(r.r2Key),
            app.storage.deleteObject(r.thumbnailKey),
          ]),
        );
      } else {
        const rows = await app.db
          .select({
            r2Key: schema.modelPoseAssets.r2Key,
            thumbnailKey: schema.modelPoseAssets.thumbnailKey,
          })
          .from(schema.modelPoseAssets)
          .where(inArray(schema.modelPoseAssets.id, ids));
        // Remove referencing jobs before hard delete (job_inputs cascade via FK)
        const jobRefs = await app.db
          .select({ jobId: schema.jobInputs.jobId })
          .from(schema.jobInputs)
          .where(inArray(schema.jobInputs.poseId, ids));
        if (jobRefs.length > 0) {
          await app.db
            .delete(schema.jobs)
            .where(inArray(schema.jobs.id, [...new Set(jobRefs.map((r) => r.jobId))]));
        }
        await app.db.delete(schema.modelPoseAssets).where(inArray(schema.modelPoseAssets.id, ids));
        void Promise.allSettled(
          rows.flatMap((r) => [
            app.storage.deleteObject(r.r2Key),
            app.storage.deleteObject(r.thumbnailKey),
          ]),
        );
      }
      return { deleted: ids.length };
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
  app.post('/admin/assets/bulk-import', { preHandler: RW }, async (req, reply) => {
    const data = await req.file();
    if (!data) throw new AppError('VALIDATION', 400, 'no file uploaded');

    // Read metadata fields from form
    const fields = data.fields as Record<string, { value?: string }>;
    const workflowTemplateId = fields.workflowTemplateId?.value ?? null;
    const genderSlug = fields.genderSlug?.value ?? 'men';

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

    // Start NDJSON stream — all validation done above
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const emit = (obj: unknown) => reply.raw.write(`${JSON.stringify(obj)}\n`);

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
    let bgDone = 0;
    for (const entry of bgEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        const numMatch = stem.match(/(\d+)$/);
        const bgNum = numMatch ? parseInt(numMatch[1], 10) : bgEntries.indexOf(entry) + 1;
        const [existing] = await app.db
          .select({
            id: schema.modelBackgrounds.id,
            r2Key: schema.modelBackgrounds.r2Key,
            deletedAt: schema.modelBackgrounds.deletedAt,
          })
          .from(schema.modelBackgrounds)
          .where(
            and(
              eq(schema.modelBackgrounds.label, stem),
              eq(schema.modelBackgrounds.genderSlug, genderSlug),
            ),
          );
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        const mime = extToMime[ext] ?? 'image/jpeg';
        const buf = entry.getData();
        const thumb = await makeThumb(buf);
        if (existing) {
          // Re-upload files; if soft-deleted, restore it
          await Promise.all([
            app.storage.putObject(existing.r2Key, buf, mime),
            app.storage.putObject(
              existing.r2Key.replace(/(\.[^.]+)?$/, '.thumb.jpg'),
              thumb,
              'image/jpeg',
            ),
          ]);
          if (existing.deletedAt) {
            await app.db
              .update(schema.modelBackgrounds)
              .set({ deletedAt: null })
              .where(eq(schema.modelBackgrounds.id, existing.id));
            createdBackgrounds++;
          }
          bgIndexMap.set(bgNum, { id: existing.id, r2Key: existing.r2Key });
        } else {
          const id = randomUUID();
          const r2Key = keys.modelBackground(id);
          const thumbKey = keys.modelBackgroundThumb(id);
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
        }
      } catch (err) {
        errors.push(`bg ${entry.name}: ${(err as Error).message}`);
      }
      emit({ phase: 'backgrounds', done: ++bgDone, total: bgEntries.length });
    }

    // Upload faces — index by filename number (face01 → 1)
    const faceIndexMap = new Map<number, { id: string; r2Key: string }>(); // faceNumber → { id, r2Key }
    let faceDone = 0;
    for (const entry of faceEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        const numMatch = stem.match(/(\d+)$/);
        const faceNum = numMatch ? parseInt(numMatch[1], 10) : faceEntries.indexOf(entry) + 1;
        const [existing] = await app.db
          .select({
            id: schema.modelFaces.id,
            r2Key: schema.modelFaces.r2Key,
            deletedAt: schema.modelFaces.deletedAt,
          })
          .from(schema.modelFaces)
          .where(and(eq(schema.modelFaces.label, stem), eq(schema.modelFaces.gender, genderSlug)));
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        const mime = extToMime[ext] ?? 'image/jpeg';
        const buf = entry.getData();
        const thumb = await makeThumb(buf);
        if (existing) {
          // Re-upload files; if soft-deleted, restore it
          await Promise.all([
            app.storage.putObject(existing.r2Key, buf, mime),
            app.storage.putObject(
              existing.r2Key.replace(/(\.[^.]+)?$/, '.thumb.jpg'),
              thumb,
              'image/jpeg',
            ),
          ]);
          if (existing.deletedAt) {
            await app.db
              .update(schema.modelFaces)
              .set({ deletedAt: null })
              .where(eq(schema.modelFaces.id, existing.id));
            createdFaces++;
          }
          faceIndexMap.set(faceNum, { id: existing.id, r2Key: existing.r2Key });
        } else {
          const id = randomUUID();
          const r2Key = keys.modelFace(id);
          const thumbKey = keys.modelFaceThumb(id);
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
        }
      } catch (err) {
        errors.push(`face ${entry.name}: ${(err as Error).message}`);
      }
      emit({ phase: 'faces', done: ++faceDone, total: faceEntries.length });
    }

    // Upload poses — extract poseZZ variant from filename (face/bg prefix no longer required)
    let _sortOrder = 0;
    let poseDone = 0;
    for (const entry of poseEntries) {
      try {
        const stem = entry.name.replace(/\.[^.]+$/, '');
        // Dedup by label + gender: skip if already exists; restore if soft-deleted
        const [existingAsset] = await app.db
          .select({
            id: schema.modelPoseAssets.id,
            r2Key: schema.modelPoseAssets.r2Key,
            thumbnailKey: schema.modelPoseAssets.thumbnailKey,
            deletedAt: schema.modelPoseAssets.deletedAt,
          })
          .from(schema.modelPoseAssets)
          .where(
            and(
              eq(schema.modelPoseAssets.label, stem),
              eq(schema.modelPoseAssets.genderSlug, genderSlug),
            ),
          );
        if (existingAsset) {
          if (existingAsset.deletedAt) {
            // Restore soft-deleted asset: re-upload files + clear deletedAt
            const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
            const mime = extToMime[ext] ?? 'image/png';
            const buf = entry.getData();
            const thumb = await makeThumb(buf);
            await Promise.all([
              app.storage.putObject(existingAsset.r2Key, buf, mime),
              app.storage.putObject(existingAsset.thumbnailKey, thumb, 'image/jpeg'),
            ]);
            await app.db
              .update(schema.modelPoseAssets)
              .set({ deletedAt: null })
              .where(eq(schema.modelPoseAssets.id, existingAsset.id));
            createdPoses++;
          }
          _sortOrder++;
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
        const poseVariantMatch = stem.match(/(?:pose|p)(\d+)$/i);
        const poseVariant = poseVariantMatch ? `pose${poseVariantMatch[1].padStart(2, '0')}` : null;
        await app.db.insert(schema.modelPoseAssets).values({
          label: stem,
          r2Key,
          thumbnailKey: thumbKey,
          workflowTemplateId: workflowTemplateId ?? null,
          genderSlug,
          poseVariant,
        });
        _sortOrder++;
        createdPoses++;
      } catch (err) {
        errors.push(`pose ${entry.name}: ${(err as Error).message}`);
      }
      emit({ phase: 'poses', done: ++poseDone, total: poseEntries.length });
    }

    if (errors.length > 0) {
      app.log.warn(
        { errors: errors.slice(0, 5), total: errors.length },
        'bulk-import partial errors',
      );
    }
    emit({
      done: true,
      created: { faces: createdFaces, backgrounds: createdBackgrounds, poses: createdPoses },
      errors,
    });
    reply.raw.end();
  });
}
