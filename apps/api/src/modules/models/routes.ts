import { schema } from '@aivastra/db';
import { and, eq, isNull, or } from 'drizzle-orm';
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
          garmentTypeId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      const { garmentTypeId } = req.query as {
        garmentTypeId: string;
      };
      const items = await app.db
        .select({
          id: schema.modelPoses.id,
          label: schema.modelPoses.label,
          thumbnailUrl: schema.modelPoses.thumbnailKey,
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
          sizeNodeId: schema.workflowTemplates.sizeNodeId,
        })
        .from(schema.modelPoses)
        .leftJoin(
          schema.workflowTemplates,
          eq(schema.modelPoses.workflowTemplateId, schema.workflowTemplates.id),
        )
        .where(
          and(
            eq(schema.modelPoses.subcategoryId, garmentTypeId),
            eq(schema.modelPoses.isActive, true),
          ),
        );
      return {
        items: items.map((i) => ({
          id: i.id,
          label: i.label,
          thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl),
          hasLower: i.lowerNodeId != null,
          hasShoes: i.shoeNodeId != null,
          hasAspectRatio: i.sizeNodeId != null,
        })),
      };
    },
  );
}
