import { schema } from '@aivastra/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildTree } from './tree.js';

export async function catalogRoutes(app: FastifyInstance) {
  app.get(
    '/v1/catalog/:type',
    {
      preHandler: app.requireUser,
      schema: {
        params: z.object({ type: z.enum(['lower', 'shoe']) }),
        querystring: z.object({
          gender: z.enum(['women', 'men', 'girls', 'boys']).optional(),
          poseIds: z.string().optional(), // comma-separated pose UUIDs
          garmentTypeId: z.string().uuid().optional(), // include garment type's default item
        }),
      },
    },
    async (req) => {
      const { type } = req.params as { type: string };
      const {
        gender,
        poseIds: poseIdsParam,
        garmentTypeId,
      } = req.query as {
        gender?: string;
        poseIds?: string;
        garmentTypeId?: string;
      };

      const poseIds = poseIdsParam ? poseIdsParam.split(',').filter(Boolean) : [];

      // If poseIds provided, check that at least one pose supports lower/shoe (via workflowTemplateId).
      // Poses are now per-gender and not tied to subcategories, so we return all active catalog
      // items of that type/gender when any selected pose has the required node.
      if (poseIds.length > 0) {
        const nodeField =
          type === 'lower'
            ? schema.workflowTemplates.lowerNodeId
            : schema.workflowTemplates.shoeNodeId;
        const supportingPoses = await app.db
          .select({ id: schema.modelPoseAssets.id })
          .from(schema.modelPoseAssets)
          .innerJoin(
            schema.workflowTemplates,
            eq(schema.modelPoseAssets.workflowTemplateId, schema.workflowTemplates.id),
          )
          .where(and(inArray(schema.modelPoseAssets.id, poseIds), isNotNull(nodeField)));

        if (supportingPoses.length === 0) return { type, tree: [] };

        // Return all active catalog items of this type/gender
        const conditions = [
          eq(schema.catalogItems.isActive, true),
          eq(schema.catalogItems.type, type),
        ];
        if (gender) conditions.push(eq(schema.catalogItems.genderSlug, gender));

        // Also ensure the garment type's default item is included
        const defaultIds: string[] = [];
        if (garmentTypeId) {
          const [gt] = await app.db
            .select({
              defaultLowerCatalogId: schema.garmentSubcategories.defaultLowerCatalogId,
              defaultShoeCatalogId: schema.garmentSubcategories.defaultShoeCatalogId,
            })
            .from(schema.garmentSubcategories)
            .where(eq(schema.garmentSubcategories.id, garmentTypeId));
          const defaultId = type === 'lower' ? gt?.defaultLowerCatalogId : gt?.defaultShoeCatalogId;
          if (defaultId) defaultIds.push(defaultId);
        }

        const items = await app.db
          .select()
          .from(schema.catalogItems)
          .where(and(...conditions));

        // Also fetch the garment type's default item if not already in the result
        let allItems = items;
        if (defaultIds.length > 0) {
          const missing = defaultIds.filter((id) => !items.some((i) => i.id === id));
          if (missing.length > 0) {
            const extraItems = await app.db
              .select()
              .from(schema.catalogItems)
              .where(inArray(schema.catalogItems.id, missing));
            allItems = [...items, ...extraItems];
          }
        }

        const enriched = allItems.map((i) => ({
          ...i,
          thumbnailUrl: app.storage.publicUrl(i.thumbnailKey),
        }));

        const catIds = [
          ...new Set(allItems.map((i) => i.categoryId).filter((id): id is number => id != null)),
        ];
        const cats =
          catIds.length > 0
            ? await app.db
                .select()
                .from(schema.catalogCategories)
                .where(
                  and(
                    inArray(schema.catalogCategories.id, catIds),
                    eq(schema.catalogCategories.isActive, true),
                  ),
                )
            : [];

        const catIdSet = new Set(cats.map((c) => c.id));
        const categorized = enriched.filter(
          (i) => i.categoryId != null && catIdSet.has(i.categoryId),
        );
        const uncategorized = enriched.filter(
          (i) => i.categoryId == null || !catIdSet.has(i.categoryId),
        );

        const tree = buildTree(cats, categorized, (key) => app.storage.publicUrl(key));
        if (uncategorized.length > 0) {
          (tree as unknown[]).push({
            id: 0,
            slug: 'other',
            label: 'Other',
            thumbnailUrl: null,
            children: [],
            items: uncategorized,
          });
        }
        return { type, tree };
      }

      // Legacy tree path — for backwards compat with items that still have categoryId
      const [t] = await app.db
        .select()
        .from(schema.catalogTypes)
        .where(eq(schema.catalogTypes.slug, type));
      if (!t) throw new AppError('NOT_FOUND', 404, 'unknown catalog type');

      const allCats = await app.db
        .select()
        .from(schema.catalogCategories)
        .where(
          and(
            eq(schema.catalogCategories.typeId, t.id),
            eq(schema.catalogCategories.isActive, true),
          ),
        );

      const cats = gender ? allCats.filter((c) => c.slug.startsWith(`${gender}-`)) : allCats;
      const catIds = new Set(cats.map((c) => c.id));

      const allItems = await app.db
        .select()
        .from(schema.catalogItems)
        .where(and(eq(schema.catalogItems.isActive, true), eq(schema.catalogItems.type, type)));

      const genderFiltered = gender ? allItems.filter((i) => i.genderSlug === gender) : allItems;
      const categorized = genderFiltered.filter(
        (i) => i.categoryId != null && catIds.has(i.categoryId),
      );
      const uncategorized = genderFiltered.filter((i) => i.categoryId == null);

      const enrichedCat = categorized.map((i) => ({
        ...i,
        thumbnailUrl: app.storage.publicUrl(i.thumbnailKey),
      }));
      const enrichedUncat = uncategorized.map((i) => ({
        ...i,
        thumbnailUrl: app.storage.publicUrl(i.thumbnailKey),
      }));

      const tree = buildTree(cats, enrichedCat, (key) => app.storage.publicUrl(key));
      if (enrichedUncat.length > 0) {
        (tree as unknown[]).push({
          id: 0,
          slug: 'other',
          label: 'Other',
          thumbnailUrl: null,
          children: [],
          items: enrichedUncat,
        });
      }
      return { type, tree };
    },
  );
}
