import { schema } from '@aivastra/db';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function modelsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/models/garment-types',
    {
      preHandler: app.requireUser,
      schema: { querystring: z.object({ gender: z.enum(['men', 'women', 'boys', 'girls']) }) },
    },
    async (req) => {
      const { gender } = req.query as { gender: string };
      const items = await app.db
        .select({
          id: schema.garmentSubcategories.id,
          slug: schema.garmentSubcategories.slug,
          label: schema.garmentSubcategories.label,
          sortOrder: schema.garmentSubcategories.sortOrder,
          thumbnailKey: schema.garmentSubcategories.thumbnailKey,
          requiresLowerUpload: schema.garmentSubcategories.requiresLowerUpload,
          defaultLowerCatalogId: schema.garmentSubcategories.defaultLowerCatalogId,
          defaultShoeCatalogId: schema.garmentSubcategories.defaultShoeCatalogId,
        })
        .from(schema.garmentSubcategories)
        .where(
          and(
            eq(schema.garmentSubcategories.genderSlug, gender),
            eq(schema.garmentSubcategories.isActive, true),
          ),
        );
      return {
        items: items.map((i) => ({
          ...i,
          thumbnailUrl: i.thumbnailKey ? app.storage.publicUrl(i.thumbnailKey) : null,
        })),
      };
    },
  );

  app.get(
    '/v1/models/faces',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']),
        }),
      },
    },
    async (req) => {
      const { gender } = req.query as { gender: string };

      const items = await app.db
        .select({
          id: schema.modelFaces.id,
          gender: schema.modelFaces.gender,
          label: schema.modelFaces.label,
          thumbnailUrl: schema.modelFaces.thumbnailKey,
        })
        .from(schema.modelFaces)
        .where(
          and(
            eq(schema.modelFaces.gender, gender),
            eq(schema.modelFaces.isActive, true),
            isNull(schema.modelFaces.deletedAt),
          ),
        );

      return {
        items: items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl) })),
      };
    },
  );

  app.get(
    '/v1/models/backgrounds',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']).optional(),
        }),
      },
    },
    async (req) => {
      const { gender } = req.query as { gender?: string };

      const rows = await app.db
        .select({
          id: schema.modelBackgrounds.id,
          label: schema.modelBackgrounds.label,
          thumbnailKey: schema.modelBackgrounds.thumbnailKey,
          isWhiteBg: schema.modelBackgrounds.isWhiteBg,
        })
        .from(schema.modelBackgrounds)
        .where(
          and(
            eq(schema.modelBackgrounds.isActive, true),
            isNull(schema.modelBackgrounds.deletedAt),
            gender
              ? or(
                  isNull(schema.modelBackgrounds.genderSlug),
                  eq(schema.modelBackgrounds.genderSlug, gender),
                )
              : undefined,
          ),
        );

      return {
        items: rows.map((b) => ({
          id: b.id,
          label: b.label,
          thumbnailUrl: app.storage.publicUrl(b.thumbnailKey),
          previewUrl: app.storage.publicUrl(b.thumbnailKey),
          isWhiteBg: b.isWhiteBg,
        })),
      };
    },
  );

  app.get(
    '/v1/models/poses',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']),
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { gender, garmentTypeId } = req.query as {
        gender: string;
        garmentTypeId?: string;
      };
      const items = await app.db
        .select({
          id: schema.modelPoseAssets.id,
          displayName: schema.modelPoseAssets.displayName,
          label: schema.modelPoseAssets.label,
          thumbnailUrl: schema.modelPoseAssets.thumbnailKey,
          // Default workflow from pose asset
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
          sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
        })
        .from(schema.modelPoseAssets)
        .leftJoin(
          schema.workflowTemplates,
          eq(schema.modelPoseAssets.workflowTemplateId, schema.workflowTemplates.id),
        )
        .where(
          and(
            eq(schema.modelPoseAssets.genderSlug, gender),
            eq(schema.modelPoseAssets.isActive, true),
            isNull(schema.modelPoseAssets.deletedAt),
          ),
        )
        .orderBy(asc(schema.modelPoseAssets.sortOrder), asc(schema.modelPoseAssets.label));

      // If garmentTypeId given, overlay per-type workflow overrides for hasLower/hasShoes
      let configMap = new Map<
        string,
        { lowerNodeId: string | null; shoeNodeId: string | null; sizeNodeIds: string[] | null }
      >();
      if (garmentTypeId && items.length > 0) {
        const poseIds = items.map((i) => i.id);
        const configs = await app.db
          .select({
            poseAssetId: schema.poseGarmentConfigs.poseAssetId,
            lowerNodeId: schema.workflowTemplates.lowerNodeId,
            shoeNodeId: schema.workflowTemplates.shoeNodeId,
            sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
          })
          .from(schema.poseGarmentConfigs)
          .leftJoin(
            schema.workflowTemplates,
            eq(schema.poseGarmentConfigs.workflowTemplateId, schema.workflowTemplates.id),
          )
          .where(
            and(
              inArray(schema.poseGarmentConfigs.poseAssetId, poseIds),
              eq(schema.poseGarmentConfigs.subcategoryId, garmentTypeId),
            ),
          );
        configMap = new Map(
          configs
            .filter((c) => c.lowerNodeId !== undefined || c.shoeNodeId !== undefined)
            .map((c) => [
              c.poseAssetId,
              {
                lowerNodeId: c.lowerNodeId ?? null,
                shoeNodeId: c.shoeNodeId ?? null,
                sizeNodeIds: c.sizeNodeIds ?? null,
              },
            ]),
        );
      }

      return {
        items: items.map((i) => {
          const cfg = configMap.get(i.id);
          const lowerNodeId = cfg !== undefined ? cfg.lowerNodeId : i.lowerNodeId;
          const shoeNodeId = cfg !== undefined ? cfg.shoeNodeId : i.shoeNodeId;
          const sizeNodeIds = cfg !== undefined ? cfg.sizeNodeIds : i.sizeNodeIds;
          return {
            id: i.id,
            label: i.displayName ?? i.label,
            thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl),
            hasLower: lowerNodeId != null,
            hasShoes: shoeNodeId != null,
            hasAspectRatio: (sizeNodeIds?.length ?? 0) > 0,
          };
        }),
      };
    },
  );
}
