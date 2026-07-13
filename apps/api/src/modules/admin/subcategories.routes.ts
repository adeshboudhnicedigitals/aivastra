import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateGarmentTypeBody,
  PatchGarmentTypeBody,
  PresignGarmentTypeBody,
  PresignGarmentTypeInstructionBody,
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
    return {
      items: rows.map((r) => ({
        ...r,
        instructionImageUrl: r.instructionImageKey
          ? app.storage.publicUrl(r.instructionImageKey)
          : null,
      })),
    };
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
    '/admin/assets/garment-types/instruction/presign',
    {
      preHandler: RW,
      schema: { body: PresignGarmentTypeInstructionBody },
    },
    async (_req) => {
      const newId = randomUUID();
      const instructionKey = keys.subcategoryInstruction(newId);
      const { url } = await app.storage.presignPut(instructionKey, 'image/jpeg', 10_000_000, 300);
      return { uploadUrl: url, instructionImageKey: instructionKey };
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
      const body = req.body as Record<string, unknown>;

      if ('instructionImageKey' in body) {
        const [current] = await app.db
          .select({ instructionImageKey: schema.garmentSubcategories.instructionImageKey })
          .from(schema.garmentSubcategories)
          .where(eq(schema.garmentSubcategories.id, id));
        if (current?.instructionImageKey) {
          await app.storage.deleteObject(current.instructionImageKey).catch(() => {});
        }
      }

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
          globalIsActive: schema.modelPoseAssets.isActive,
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
          // Effective active state for this garment type: the per-type override
          // wins when set, otherwise fall back to the pose asset's global flag.
          const isActive = cfg?.isActive ?? p.globalIsActive;
          return {
            ...p,
            isActive,
            thumbnailUrl: app.storage.publicUrl(p.thumbnailKey),
            config: cfg
              ? {
                  workflowTemplateId: cfg.workflowTemplateId,
                  promptGarmentPhase: cfg.promptGarmentPhase,
                  promptFacePhase: cfg.promptFacePhase,
                  isActive: cfg.isActive,
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
          isActive: z.boolean().nullable(),
        }),
      },
    },
    async (req) => {
      const { id, poseAssetId } = req.params as { id: string; poseAssetId: string };
      const { workflowTemplateId, promptGarmentPhase, promptFacePhase, isActive } = req.body as {
        workflowTemplateId: string | null;
        promptGarmentPhase: string | null;
        promptFacePhase: string | null;
        isActive: boolean | null;
      };

      const hasOverride =
        workflowTemplateId || promptGarmentPhase || promptFacePhase || isActive !== null;
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
          isActive,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.poseGarmentConfigs.poseAssetId, schema.poseGarmentConfigs.subcategoryId],
          set: {
            workflowTemplateId: workflowTemplateId ?? null,
            promptGarmentPhase: promptGarmentPhase ?? null,
            promptFacePhase: promptFacePhase ?? null,
            isActive,
            updatedAt: new Date(),
          },
        });

      return { ok: true, action: 'upserted' };
    },
  );

  // ── Per-garment-type catalogue-template mapping ───────────────────────────
  // Which catalogue templates are offered for this garment type — pure
  // enablement, no override data (per-pose workflow variance is handled
  // separately and already, by pose_garment_configs above).

  // GET /admin/assets/garment-types/:id/templates
  // Returns every SAME-GENDER catalogue template, each flagged mapped:true/false.
  app.get(
    '/admin/assets/garment-types/:id/templates',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [sub] = await app.db
        .select({ genderSlug: schema.garmentSubcategories.genderSlug })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      const templates = await app.db
        .select({
          id: schema.catalogueTemplates.id,
          label: schema.catalogueTemplates.label,
          thumbnailKey: schema.catalogueTemplates.thumbnailKey,
        })
        .from(schema.catalogueTemplates)
        .where(
          and(
            eq(schema.catalogueTemplates.genderSlug, sub.genderSlug ?? ''),
            isNull(schema.catalogueTemplates.deletedAt),
          ),
        )
        .orderBy(asc(schema.catalogueTemplates.sortOrder), asc(schema.catalogueTemplates.label));

      const mappedRows = await app.db
        .select({ templateId: schema.catalogueTemplateSubcategories.templateId })
        .from(schema.catalogueTemplateSubcategories)
        .where(eq(schema.catalogueTemplateSubcategories.subcategoryId, id));
      const mappedSet = new Set(mappedRows.map((r) => r.templateId));

      return {
        items: templates.map((t) => ({
          id: t.id,
          label: t.label,
          thumbnailUrl: t.thumbnailKey ? app.storage.publicUrl(t.thumbnailKey) : null,
          mapped: mappedSet.has(t.id),
        })),
      };
    },
  );

  // PATCH /admin/assets/garment-types/:id/templates/:templateId
  // mapped:true inserts the mapping row (no-op if already present), mapped:false
  // deletes it. No override data to upsert — plain membership toggle.
  app.patch(
    '/admin/assets/garment-types/:id/templates/:templateId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), templateId: z.string().uuid() }),
        body: z.object({ mapped: z.boolean() }),
      },
    },
    async (req) => {
      const { id, templateId } = req.params as { id: string; templateId: string };
      const { mapped } = req.body as { mapped: boolean };

      if (mapped) {
        await app.db
          .insert(schema.catalogueTemplateSubcategories)
          .values({ templateId, subcategoryId: id })
          .onConflictDoNothing();
      } else {
        await app.db
          .delete(schema.catalogueTemplateSubcategories)
          .where(
            and(
              eq(schema.catalogueTemplateSubcategories.templateId, templateId),
              eq(schema.catalogueTemplateSubcategories.subcategoryId, id),
            ),
          );
      }

      return { ok: true };
    },
  );
}
