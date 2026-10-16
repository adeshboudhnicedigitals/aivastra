import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateBodyTypeBody,
  PatchBodyTypeBody,
  PresignBodyTypeThumbnailBody,
} from '@aivastra/types';
import { and, asc, eq, ilike, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

export async function adminBodyTypesRoutes(app: FastifyInstance) {
  const RW = requirePermission('body_types.write');
  const D = requirePermission('body_types.delete');
  const uuidParam = z.object({ id: z.string().uuid() });
  const mappedBody = z.object({ mapped: z.boolean() });

  app.get('/admin/assets/body-types', { preHandler: RW }, async () => {
    const items = await app.db
      .select()
      .from(schema.bodyTypes)
      .where(isNull(schema.bodyTypes.deletedAt))
      .orderBy(asc(schema.bodyTypes.sortOrder), asc(schema.bodyTypes.label));
    return {
      items: await Promise.all(
        items.map(async (t) => ({
          ...t,
          thumbnailUrl: t.thumbnailKey
            ? (await app.storage.presignGet(t.thumbnailKey, 3600)).url
            : null,
        })),
      ),
    };
  });

  app.post(
    '/admin/assets/body-types/thumbnail/presign',
    { preHandler: RW, schema: { body: PresignBodyTypeThumbnailBody } },
    async (_req) => {
      const newId = randomUUID();
      const thumbnailKey = keys.bodyTypeThumb(newId);
      const { url } = await app.storage.presignPut(thumbnailKey, 'image/jpeg', 5_000_000, 300);
      return { uploadUrl: url, thumbnailKey };
    },
  );

  app.post(
    '/admin/assets/body-types',
    { preHandler: RW, schema: { body: CreateBodyTypeBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateBodyTypeBody>;
      const [existingLabel] = await app.db
        .select({ id: schema.bodyTypes.id })
        .from(schema.bodyTypes)
        .where(
          and(
            ilike(schema.bodyTypes.label, body.label),
            eq(schema.bodyTypes.genderSlug, body.genderSlug),
            isNull(schema.bodyTypes.deletedAt),
          ),
        );
      if (existingLabel) {
        throw new AppError('CONFLICT', 409, `label "${body.label}" already exists`);
      }
      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.bodyTypes)
          .values({
            genderSlug: body.genderSlug,
            label: body.label,
            thumbnailKey: body.thumbnailKey ?? null,
            sortOrder: body.sortOrder,
          })
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'body_type.create',
          resourceType: 'body_type',
          resourceId: inserted.id,
          after: { id: inserted.id, label: inserted.label, genderSlug: inserted.genderSlug },
          request: req,
        });
        return inserted;
      });
      return row;
    },
  );

  app.patch(
    '/admin/assets/body-types/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchBodyTypeBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if (typeof body.label === 'string') {
        const [current] = await app.db
          .select({ genderSlug: schema.bodyTypes.genderSlug })
          .from(schema.bodyTypes)
          .where(eq(schema.bodyTypes.id, id));
        const [existingLabel] = await app.db
          .select({ id: schema.bodyTypes.id })
          .from(schema.bodyTypes)
          .where(
            and(
              ilike(schema.bodyTypes.label, body.label),
              isNull(schema.bodyTypes.deletedAt),
              ne(schema.bodyTypes.id, id),
              current ? eq(schema.bodyTypes.genderSlug, current.genderSlug) : undefined,
            ),
          );
        if (existingLabel) {
          throw new AppError('CONFLICT', 409, `label "${body.label}" already exists`);
        }
      }
      if ('thumbnailKey' in body) {
        const [current] = await app.db
          .select({ thumbnailKey: schema.bodyTypes.thumbnailKey })
          .from(schema.bodyTypes)
          .where(eq(schema.bodyTypes.id, id));
        if (current?.thumbnailKey) {
          await app.storage.deleteObject(current.thumbnailKey).catch(() => {});
        }
      }
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.bodyTypes)
          .where(eq(schema.bodyTypes.id, id))
          .for('update');
        if (!before) throw new AppError('NOT_FOUND', 404, 'body type not found');

        await tx
          .update(schema.bodyTypes)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.bodyTypes.id, id));

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'body_type.update',
          resourceType: 'body_type',
          resourceId: id,
          before,
          after: { ...before, ...body },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/body-types/:id',
    { preHandler: D, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db.select().from(schema.bodyTypes).where(eq(schema.bodyTypes.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'body type not found');
      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.bodyTypes)
          .set({ deletedAt: new Date() })
          .where(eq(schema.bodyTypes.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'body_type.delete',
          resourceType: 'body_type',
          resourceId: id,
          before: { id: row.id, label: row.label },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  // ── Seed source: faces/poses already mapped to any garment type of a gender ─
  // Backs the "include all garment-type-mapped assets" toggle on the create/edit
  // body-type modal — the union of every face/pose with at least one explicit
  // model_face_subcategories/pose_garment_configs row for a garment type of that
  // gender, not simply every active face/pose of that gender.
  app.get(
    '/admin/assets/body-types/garment-mapped-assets',
    { preHandler: RW, schema: { querystring: z.object({ genderSlug: z.string() }) } },
    async (req) => {
      const { genderSlug } = req.query as { genderSlug: string };

      const faceRows = await app.db
        .select({ faceId: schema.modelFaceSubcategories.faceId })
        .from(schema.modelFaceSubcategories)
        .innerJoin(
          schema.garmentSubcategories,
          eq(schema.garmentSubcategories.id, schema.modelFaceSubcategories.subcategoryId),
        )
        .where(eq(schema.garmentSubcategories.genderSlug, genderSlug));

      const poseRows = await app.db
        .select({ poseAssetId: schema.poseGarmentConfigs.poseAssetId })
        .from(schema.poseGarmentConfigs)
        .innerJoin(
          schema.garmentSubcategories,
          eq(schema.garmentSubcategories.id, schema.poseGarmentConfigs.subcategoryId),
        )
        .where(eq(schema.garmentSubcategories.genderSlug, genderSlug));

      return {
        faceIds: [...new Set(faceRows.map((r) => r.faceId))],
        poseAssetIds: [...new Set(poseRows.map((r) => r.poseAssetId))],
      };
    },
  );

  // ── Body type -> garment type mapping ───────────────────────────────────────
  // No rows for a body type = opt-out (every active garment type of that gender is
  // shown). Once any explicit mapping exists for the body type, only mapped garment
  // types are shown — see bodyTypeSubcategories in packages/db/src/schema/models.ts.
  app.get(
    '/admin/assets/body-types/:id/garment-type-mappings',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [bodyType] = await app.db
        .select({ id: schema.bodyTypes.id })
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const mappings = await app.db
        .select({ subcategoryId: schema.bodyTypeSubcategories.subcategoryId })
        .from(schema.bodyTypeSubcategories)
        .where(eq(schema.bodyTypeSubcategories.bodyTypeId, id));

      const mappedSubcategoryIds = mappings.map((m) => m.subcategoryId);
      return {
        mappedSubcategoryIds,
        hasExplicitSubcategoryMappings: mappedSubcategoryIds.length > 0,
      };
    },
  );

  app.put(
    '/admin/assets/body-types/:id/garment-types/:subcategoryId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), subcategoryId: z.string().uuid() }),
        body: mappedBody,
      },
    },
    async (req) => {
      const { id, subcategoryId } = req.params as { id: string; subcategoryId: string };
      const { mapped } = req.body as { mapped: boolean };

      const [bodyType] = await app.db
        .select()
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const [sub] = await app.db
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, subcategoryId));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      await app.db.transaction(async (tx) => {
        if (mapped) {
          await tx
            .insert(schema.bodyTypeSubcategories)
            .values({ bodyTypeId: id, subcategoryId })
            .onConflictDoNothing();
        } else {
          const [hasExplicit] = await tx
            .select({ one: schema.bodyTypeSubcategories.subcategoryId })
            .from(schema.bodyTypeSubcategories)
            .where(eq(schema.bodyTypeSubcategories.bodyTypeId, id))
            .limit(1);

          if (!hasExplicit) {
            // Populate every other active garment type of this gender so unmapping this
            // one narrows the set instead of silently falling back to "show everyone".
            const others = await tx
              .select({ id: schema.garmentSubcategories.id })
              .from(schema.garmentSubcategories)
              .where(
                and(
                  eq(schema.garmentSubcategories.genderSlug, bodyType.genderSlug),
                  eq(schema.garmentSubcategories.isActive, true),
                  ne(schema.garmentSubcategories.id, subcategoryId),
                ),
              );
            if (others.length > 0) {
              await tx
                .insert(schema.bodyTypeSubcategories)
                .values(others.map((o) => ({ bodyTypeId: id, subcategoryId: o.id })))
                .onConflictDoNothing();
            }
          } else {
            await tx
              .delete(schema.bodyTypeSubcategories)
              .where(
                and(
                  eq(schema.bodyTypeSubcategories.bodyTypeId, id),
                  eq(schema.bodyTypeSubcategories.subcategoryId, subcategoryId),
                ),
              );
          }
        }
      });

      return { ok: true, mapped };
    },
  );

  // ── Body type -> face mapping ───────────────────────────────────────────────
  app.get(
    '/admin/assets/body-types/:id/face-mappings',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [bodyType] = await app.db
        .select({ id: schema.bodyTypes.id })
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const mappings = await app.db
        .select({ faceId: schema.bodyTypeFaces.faceId })
        .from(schema.bodyTypeFaces)
        .where(eq(schema.bodyTypeFaces.bodyTypeId, id));

      const mappedFaceIds = mappings.map((m) => m.faceId);
      return {
        mappedFaceIds,
        hasExplicitFaceMappings: mappedFaceIds.length > 0,
      };
    },
  );

  app.put(
    '/admin/assets/body-types/:id/faces/:faceId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), faceId: z.string().uuid() }),
        body: mappedBody,
      },
    },
    async (req) => {
      const { id, faceId } = req.params as { id: string; faceId: string };
      const { mapped } = req.body as { mapped: boolean };

      const [bodyType] = await app.db
        .select()
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const [face] = await app.db
        .select()
        .from(schema.modelFaces)
        .where(eq(schema.modelFaces.id, faceId));
      if (!face) throw new AppError('NOT_FOUND', 404, 'face not found');

      await app.db.transaction(async (tx) => {
        if (mapped) {
          await tx
            .insert(schema.bodyTypeFaces)
            .values({ bodyTypeId: id, faceId })
            .onConflictDoNothing();
        } else {
          const [hasExplicit] = await tx
            .select({ one: schema.bodyTypeFaces.faceId })
            .from(schema.bodyTypeFaces)
            .where(eq(schema.bodyTypeFaces.bodyTypeId, id))
            .limit(1);

          if (!hasExplicit) {
            const others = await tx
              .select({ id: schema.modelFaces.id })
              .from(schema.modelFaces)
              .where(
                and(
                  eq(schema.modelFaces.gender, bodyType.genderSlug),
                  eq(schema.modelFaces.isActive, true),
                  isNull(schema.modelFaces.deletedAt),
                  ne(schema.modelFaces.id, faceId),
                ),
              );
            if (others.length > 0) {
              await tx
                .insert(schema.bodyTypeFaces)
                .values(others.map((o) => ({ bodyTypeId: id, faceId: o.id })))
                .onConflictDoNothing();
            }
          } else {
            await tx
              .delete(schema.bodyTypeFaces)
              .where(
                and(
                  eq(schema.bodyTypeFaces.bodyTypeId, id),
                  eq(schema.bodyTypeFaces.faceId, faceId),
                ),
              );
          }
        }
      });

      return { ok: true, mapped };
    },
  );

  // ── Body type -> pose mapping ────────────────────────────────────────────────
  app.get(
    '/admin/assets/body-types/:id/pose-mappings',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [bodyType] = await app.db
        .select({ id: schema.bodyTypes.id })
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const mappings = await app.db
        .select({ poseAssetId: schema.bodyTypePoses.poseAssetId })
        .from(schema.bodyTypePoses)
        .where(eq(schema.bodyTypePoses.bodyTypeId, id));

      const mappedPoseAssetIds = mappings.map((m) => m.poseAssetId);
      return {
        mappedPoseAssetIds,
        hasExplicitPoseMappings: mappedPoseAssetIds.length > 0,
      };
    },
  );

  app.put(
    '/admin/assets/body-types/:id/poses/:poseId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), poseId: z.string().uuid() }),
        body: mappedBody,
      },
    },
    async (req) => {
      const { id, poseId } = req.params as { id: string; poseId: string };
      const { mapped } = req.body as { mapped: boolean };

      const [bodyType] = await app.db
        .select()
        .from(schema.bodyTypes)
        .where(and(eq(schema.bodyTypes.id, id), isNull(schema.bodyTypes.deletedAt)));
      if (!bodyType) throw new AppError('NOT_FOUND', 404, 'body type not found');

      const [pose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, poseId));
      if (!pose) throw new AppError('NOT_FOUND', 404, 'pose not found');

      await app.db.transaction(async (tx) => {
        if (mapped) {
          await tx
            .insert(schema.bodyTypePoses)
            .values({ bodyTypeId: id, poseAssetId: poseId })
            .onConflictDoNothing();
        } else {
          const [hasExplicit] = await tx
            .select({ one: schema.bodyTypePoses.poseAssetId })
            .from(schema.bodyTypePoses)
            .where(eq(schema.bodyTypePoses.bodyTypeId, id))
            .limit(1);

          if (!hasExplicit) {
            const others = await tx
              .select({ id: schema.modelPoseAssets.id })
              .from(schema.modelPoseAssets)
              .where(
                and(
                  eq(schema.modelPoseAssets.genderSlug, bodyType.genderSlug),
                  eq(schema.modelPoseAssets.isActive, true),
                  isNull(schema.modelPoseAssets.deletedAt),
                  ne(schema.modelPoseAssets.id, poseId),
                ),
              );
            if (others.length > 0) {
              await tx
                .insert(schema.bodyTypePoses)
                .values(others.map((o) => ({ bodyTypeId: id, poseAssetId: o.id })))
                .onConflictDoNothing();
            }
          } else {
            await tx
              .delete(schema.bodyTypePoses)
              .where(
                and(
                  eq(schema.bodyTypePoses.bodyTypeId, id),
                  eq(schema.bodyTypePoses.poseAssetId, poseId),
                ),
              );
          }
        }
      });

      return { ok: true, mapped };
    },
  );
}
