import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateGarmentTypeBody,
  PatchGarmentTypeBody,
  PresignGarmentTypeBody,
} from '@aivastra/types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminGarmentTypesRoutes(app: FastifyInstance) {
  const RW = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
  const D = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/garment-types', { preHandler: RW }, async () => {
    const rows = await app.db.select().from(schema.garmentSubcategories);
    return { items: rows };
  });

  app.post(
    '/admin/assets/garment-types/presign',
    {
      preHandler: RW,
      schema: { body: PresignGarmentTypeBody },
    },
    async (_req) => {
      const newId = randomUUID();
      const thumbKey = keys.subcategoryThumb(newId);
      // contentType is still validated by the route schema, but the uploaded image is
      // downscaled to JPEG client-side — sign for image/jpeg so the PUT header matches.
      const { url } = await app.storage.presignPut(thumbKey, 'image/jpeg', 5_000_000, 300);
      return { uploadUrl: url, thumbnailKey: thumbKey };
    },
  );

  app.post(
    '/admin/assets/garment-types',
    {
      preHandler: RW,
      schema: { body: CreateGarmentTypeBody },
    },
    async (req) => {
      const {
        genderSlug,
        slug,
        label,
        sortOrder,
        thumbnailKey,
        requiresLowerUpload,
        tryonCategoryId,
      } = req.body as {
        genderSlug: string;
        slug: string;
        label: string;
        sortOrder: number;
        thumbnailKey?: string;
        requiresLowerUpload?: boolean;
        tryonCategoryId?: string | null;
      };
      const [row] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug,
          slug,
          label,
          sortOrder,
          thumbnailKey,
          requiresLowerUpload: requiresLowerUpload ?? false,
          tryonCategoryId: tryonCategoryId ?? null,
        })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/garment-types/:id',
    {
      preHandler: RW,
      schema: { params: uuidParam, body: PatchGarmentTypeBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { isActive?: boolean; [key: string]: unknown };

      const [updated] = await app.db
        .update(schema.garmentSubcategories)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.garmentSubcategories.id, id))
        .returning({ id: schema.garmentSubcategories.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'garment type not found');
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/garment-types/:id',
    {
      preHandler: D,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [sub] = await app.db
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      await app.db
        .delete(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));

      return { ok: true };
    },
  );

  // ── Per-garment-type pose configs ─────────────────────────────────────────

  // GET /admin/assets/garment-types/:id/pose-configs
  // Returns all active poses for the garment type's gender, with their override config (if any).
  app.get(
    '/admin/assets/garment-types/:id/pose-configs',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [sub] = await app.db
        .select({ genderSlug: schema.garmentSubcategories.genderSlug })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      const poses = await app.db
        .select({
          id: schema.modelPoseAssets.id,
          isActive: schema.modelPoseAssets.isActive,
          label: schema.modelPoseAssets.label,
          displayName: schema.modelPoseAssets.displayName,
          thumbnailKey: schema.modelPoseAssets.thumbnailKey,
          defaultWorkflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
          defaultPromptGarmentPhase: schema.modelPoseAssets.promptGarmentPhase,
          defaultPromptFacePhase: schema.modelPoseAssets.promptFacePhase,
        })
        .from(schema.modelPoseAssets)
        .where(
          and(
            eq(schema.modelPoseAssets.genderSlug, sub.genderSlug ?? ''),
            isNull(schema.modelPoseAssets.deletedAt),
          ),
        )
        .orderBy(asc(schema.modelPoseAssets.sortOrder), asc(schema.modelPoseAssets.label));

      const poseIds = poses.map((p) => p.id);
      const configs =
        poseIds.length > 0
          ? await app.db
              .select()
              .from(schema.poseGarmentConfigs)
              .where(
                and(
                  inArray(schema.poseGarmentConfigs.poseAssetId, poseIds),
                  eq(schema.poseGarmentConfigs.subcategoryId, id),
                ),
              )
          : [];

      const configMap = new Map(configs.map((c) => [c.poseAssetId, c]));

      return {
        items: poses.map((p) => {
          const cfg = configMap.get(p.id) ?? null;
          return {
            ...p,
            thumbnailUrl: app.storage.publicUrl(p.thumbnailKey),
            config: cfg
              ? {
                  workflowTemplateId: cfg.workflowTemplateId,
                  promptGarmentPhase: cfg.promptGarmentPhase,
                  promptFacePhase: cfg.promptFacePhase,
                }
              : null,
          };
        }),
      };
    },
  );

  // PATCH /admin/assets/garment-types/:id/pose-configs/:poseAssetId
  // Upsert override. If all override fields are null/empty, deletes the config row.
  app.patch(
    '/admin/assets/garment-types/:id/pose-configs/:poseAssetId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), poseAssetId: z.string().uuid() }),
        body: z.object({
          workflowTemplateId: z.string().uuid().nullable(),
          promptGarmentPhase: z.string().nullable(),
          promptFacePhase: z.string().nullable(),
        }),
      },
    },
    async (req) => {
      const { id, poseAssetId } = req.params as { id: string; poseAssetId: string };
      const { workflowTemplateId, promptGarmentPhase, promptFacePhase } = req.body as {
        workflowTemplateId: string | null;
        promptGarmentPhase: string | null;
        promptFacePhase: string | null;
      };

      const hasOverride = workflowTemplateId || promptGarmentPhase || promptFacePhase;
      if (!hasOverride) {
        await app.db
          .delete(schema.poseGarmentConfigs)
          .where(
            and(
              eq(schema.poseGarmentConfigs.poseAssetId, poseAssetId),
              eq(schema.poseGarmentConfigs.subcategoryId, id),
            ),
          );
        return { ok: true, action: 'deleted' };
      }

      await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId,
          subcategoryId: id,
          workflowTemplateId: workflowTemplateId ?? null,
          promptGarmentPhase: promptGarmentPhase ?? null,
          promptFacePhase: promptFacePhase ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.poseGarmentConfigs.poseAssetId, schema.poseGarmentConfigs.subcategoryId],
          set: {
            workflowTemplateId: workflowTemplateId ?? null,
            promptGarmentPhase: promptGarmentPhase ?? null,
            promptFacePhase: promptFacePhase ?? null,
            updatedAt: new Date(),
          },
        });

      return { ok: true, action: 'upserted' };
    },
  );
}
