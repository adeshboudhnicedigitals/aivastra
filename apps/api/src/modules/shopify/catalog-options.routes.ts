import { schema } from '@aivastra/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const GENDERS = ['men', 'women', 'boys', 'girls'] as const;

const OptionsQuery = z.object({
  gender: z.enum(GENDERS),
  garmentTypeId: z.string().uuid().optional(),
});

async function fetchCatalogItems(
  app: FastifyInstance,
  type: 'lower' | 'shoe',
  gender: string,
  garmentTypeId?: string,
) {
  let allowedIds: string[] | null = null;
  if (garmentTypeId) {
    const [gt] = await app.db
      .select({
        defaultLowerCatalogId: schema.garmentSubcategories.defaultLowerCatalogId,
        defaultShoeCatalogId: schema.garmentSubcategories.defaultShoeCatalogId,
      })
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));
    const mappings = await app.db
      .select({ catalogItemId: schema.catalogItemSubcategories.catalogItemId })
      .from(schema.catalogItemSubcategories)
      .where(eq(schema.catalogItemSubcategories.subcategoryId, garmentTypeId));
    const defaultId = type === 'lower' ? gt?.defaultLowerCatalogId : gt?.defaultShoeCatalogId;
    allowedIds = [
      ...new Set([...mappings.map((m) => m.catalogItemId), ...(defaultId ? [defaultId] : [])]),
    ];
    if (allowedIds.length === 0) return [];
  }

  const conditions = [
    eq(schema.catalogItems.isActive, true),
    eq(schema.catalogItems.type, type),
    eq(schema.catalogItems.genderSlug, gender),
  ];
  if (allowedIds) conditions.push(inArray(schema.catalogItems.id, allowedIds));

  const items = await app.db
    .select()
    .from(schema.catalogItems)
    .where(and(...conditions));

  return items.map((i) => ({
    id: i.id,
    label: i.label,
    thumbnailUrl: app.storage.publicUrl(i.thumbnailKey),
  }));
}

export async function shopifyCatalogOptionsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/shopify/catalog/options',
    { preHandler: app.requireShopifySession, schema: { querystring: OptionsQuery } },
    async (req) => {
      const { gender, garmentTypeId } = req.query as z.infer<typeof OptionsQuery>;

      const garmentTypes = await app.db
        .select({
          id: schema.garmentSubcategories.id,
          label: schema.garmentSubcategories.label,
          sortOrder: schema.garmentSubcategories.sortOrder,
        })
        .from(schema.garmentSubcategories)
        .where(
          and(
            eq(schema.garmentSubcategories.genderSlug, gender),
            eq(schema.garmentSubcategories.isActive, true),
          ),
        )
        .orderBy(asc(schema.garmentSubcategories.sortOrder));

      const faceRows = await app.db
        .select({
          id: schema.modelFaces.id,
          label: schema.modelFaces.label,
          thumbnailKey: schema.modelFaces.thumbnailKey,
        })
        .from(schema.modelFaces)
        .where(
          and(
            eq(schema.modelFaces.gender, gender),
            eq(schema.modelFaces.isActive, true),
            isNull(schema.modelFaces.deletedAt),
          ),
        );
      const faces = faceRows.map((f) => ({
        id: f.id,
        label: f.label,
        thumbnailUrl: app.storage.publicUrl(f.thumbnailKey),
      }));

      const backgroundRows = await app.db
        .select({
          id: schema.modelBackgrounds.id,
          label: schema.modelBackgrounds.label,
          thumbnailKey: schema.modelBackgrounds.thumbnailKey,
        })
        .from(schema.modelBackgrounds)
        .where(
          and(
            eq(schema.modelBackgrounds.isActive, true),
            isNull(schema.modelBackgrounds.deletedAt),
            eq(schema.modelBackgrounds.scope, 'general'),
          ),
        );
      const backgrounds = backgroundRows.map((b) => ({
        id: b.id,
        label: b.label,
        thumbnailUrl: app.storage.publicUrl(b.thumbnailKey),
      }));

      const poseRows = await app.db
        .select({
          id: schema.modelPoseAssets.id,
          label: schema.modelPoseAssets.displayName,
          fallbackLabel: schema.modelPoseAssets.label,
          thumbnailKey: schema.modelPoseAssets.thumbnailKey,
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
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
            eq(schema.modelPoseAssets.scope, 'general'),
          ),
        );
      const poses = poseRows.map((p) => ({
        id: p.id,
        label: p.label ?? p.fallbackLabel,
        thumbnailUrl: app.storage.publicUrl(p.thumbnailKey),
        hasLower: p.lowerNodeId != null,
        hasShoes: p.shoeNodeId != null,
      }));

      const [lowerItems, shoeItems] = await Promise.all([
        fetchCatalogItems(app, 'lower', gender, garmentTypeId),
        fetchCatalogItems(app, 'shoe', gender, garmentTypeId),
      ]);

      return { garmentTypes, faces, backgrounds, poses, lowerItems, shoeItems };
    },
  );
}
