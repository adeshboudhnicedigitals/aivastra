import { schema } from '@aivastra/db';
import { computePixverseVideoCost, type PixverseQuality } from '@aivastra/types';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isCatalogVideoAllowed } from '../../lib/catalog-video-access.js';
import { AppError } from '../../lib/errors.js';
import { getPixverseVideoPricingConfig } from '../../lib/resolution-config.js';
import { poseGarmentRoles } from './garment-roles.js';
import { listCatalogueTemplates, listFaces, listGarmentTypes } from './queries.js';

export async function modelsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/models/garment-types',
    {
      preHandler: app.requireUserOrCatalogApp,
      schema: { querystring: z.object({ gender: z.enum(['men', 'women', 'boys', 'girls']) }) },
    },
    async (req) => listGarmentTypes(app, (req.query as { gender: string }).gender),
  );

  app.get('/v1/models/sample-videos', { preHandler: app.requireUser }, async (req) => {
    const [caller] = await app.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId));
    if (!isCatalogVideoAllowed(app.env, caller?.email ?? null)) {
      throw new AppError('FORBIDDEN', 403, 'catalog video is not enabled for this account');
    }
    const rows = await app.db
      .select({
        id: schema.sampleVideos.id,
        title: schema.sampleVideos.title,
        prompt: schema.sampleVideos.prompt,
        thumbnailR2Key: schema.sampleVideos.thumbnailR2Key,
        videoR2Key: schema.sampleVideos.videoR2Key,
        duration: schema.sampleVideos.duration,
        quality: schema.sampleVideos.quality,
      })
      .from(schema.sampleVideos)
      .where(and(eq(schema.sampleVideos.isActive, true), isNull(schema.sampleVideos.deletedAt)))
      .orderBy(asc(schema.sampleVideos.sortOrder));
    // Resolve pricing once, up front, rather than in parallel with the
    // per-row map below — every row's creditCost is now computed from this
    // exact same snapshot via the pure computePixverseVideoCost, instead of
    // each row independently re-reading (and re-resolving) config from Redis
    // via getPixverseVideoCreditCost. That was N redundant round-trips per
    // request, and meant the exposed pixverseVideoPricing and each item's
    // creditCost could theoretically straddle an admin PATCH mid-request.
    const pixverseVideoPricing = await getPixverseVideoPricingConfig(app);
    const items = await Promise.all(
      rows.map(async (row) => {
        const [thumbnail, video] = await Promise.all([
          app.storage.presignGet(row.thumbnailR2Key, 3_600),
          app.storage.presignGet(row.videoR2Key, 3_600),
        ]);

        return {
          id: row.id,
          title: row.title,
          prompt: row.prompt,
          thumbnailUrl: thumbnail.url,
          previewVideoUrl: video.url,
          // The preset's own admin-set values — Motion Studio pre-fills its
          // duration/quality controls from these when a preset is picked,
          // then lets the caller override them (see CreateCatalogVideoJobRequest).
          duration: row.duration,
          quality: row.quality as PixverseQuality,
          creditCost: computePixverseVideoCost(
            row.duration,
            row.quality as PixverseQuality,
            pixverseVideoPricing,
          ),
        };
      }),
    );
    return { items, pixverseVideoPricing };
  });

  app.get(
    '/v1/models/faces',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']),
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => listFaces(app, req.query as { gender: string; garmentTypeId?: string }),
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
          categoryId: schema.modelBackgrounds.categoryId,
          tags: schema.modelBackgrounds.tags,
          specialTag: schema.modelBackgrounds.specialTag,
        })
        .from(schema.modelBackgrounds)
        .where(
          and(
            eq(schema.modelBackgrounds.isActive, true),
            isNull(schema.modelBackgrounds.deletedAt),
            // Template-scoped backgrounds are managed only via their owning
            // catalogue template — never offered in "create your own look".
            eq(schema.modelBackgrounds.scope, 'general'),
            gender
              ? or(
                  isNull(schema.modelBackgrounds.genderSlug),
                  eq(schema.modelBackgrounds.genderSlug, gender),
                )
              : undefined,
          ),
        )
        // Admin-curated position (Assets → Backgrounds → Sort order); label/id break
        // ties so the picker order is stable instead of Postgres heap order.
        .orderBy(
          asc(schema.modelBackgrounds.sortOrder),
          asc(schema.modelBackgrounds.label),
          asc(schema.modelBackgrounds.id),
        );

      return {
        items: await Promise.all(
          rows.map(async (b) => {
            const thumbnailUrl = (await app.storage.presignGet(b.thumbnailKey, 3600)).url;
            return {
              id: b.id,
              label: b.label,
              thumbnailUrl,
              previewUrl: thumbnailUrl,
              isWhiteBg: b.isWhiteBg,
              categoryId: b.categoryId,
              tags: b.tags,
              specialTag: b.specialTag,
            };
          }),
        ),
      };
    },
  );

  app.get(
    '/v1/models/background-categories',
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
          id: schema.catalogCategories.id,
          slug: schema.catalogCategories.slug,
          label: schema.catalogCategories.label,
          thumbnailKey: schema.catalogCategories.thumbnailKey,
          genderSlug: schema.catalogCategories.genderSlug,
          sortOrder: schema.catalogCategories.sortOrder,
        })
        .from(schema.catalogCategories)
        .innerJoin(schema.catalogTypes, eq(schema.catalogCategories.typeId, schema.catalogTypes.id))
        .where(
          and(
            eq(schema.catalogTypes.slug, 'background'),
            eq(schema.catalogCategories.isActive, true),
            gender
              ? or(
                  isNull(schema.catalogCategories.genderSlug),
                  eq(schema.catalogCategories.genderSlug, gender),
                )
              : undefined,
          ),
        )
        .orderBy(schema.catalogCategories.sortOrder);

      return {
        items: await Promise.all(
          rows.map(async (c) => ({
            id: c.id,
            slug: c.slug,
            label: c.label,
            thumbnailUrl: c.thumbnailKey
              ? (await app.storage.presignGet(c.thumbnailKey, 3600)).url
              : null,
          })),
        ),
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
          upperNodeIds: schema.workflowTemplates.upperNodeIds,
          lowerNodeId: schema.workflowTemplates.lowerNodeId,
          shoeNodeId: schema.workflowTemplates.shoeNodeId,
          accessoryNodeId: schema.workflowTemplates.accessoryNodeId,
          sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
          garmentView: schema.workflowTemplates.garmentView,
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
            // Template-scoped poses are managed only via their owning catalogue
            // template — never offered in "create your own look".
            eq(schema.modelPoseAssets.scope, 'general'),
          ),
        )
        .orderBy(asc(schema.modelPoseAssets.sortOrder), asc(schema.modelPoseAssets.label));

      // If garmentTypeId given, overlay per-type workflow overrides for hasLower/hasShoes,
      // and apply strict opt-in visibility: a pose shows for a garment type only when a
      // pose_garment_configs row exists for it. isActive on that row is a *narrowing*
      // override (null = inherit, i.e. still visible — e.g. a workflow-only override
      // row — false = explicitly hidden), not the opt-in signal itself; the row's mere
      // existence is. Mirrors the admin's own "assigned poses" reporting, enforced there
      // in the 2026-10-05 opt-in pose mapping change but never carried over to this
      // public endpoint until now (see docs/progress.md).
      let configMap = new Map<
        string,
        {
          upperNodeIds: string[] | null;
          lowerNodeId: string | null;
          shoeNodeId: string | null;
          accessoryNodeId: string | null;
          sizeNodeIds: string[] | null;
          garmentView: string;
        }
      >();
      let activeForType: Set<string> | null = null;
      if (garmentTypeId && items.length > 0) {
        const poseIds = items.map((i) => i.id);
        const configs = await app.db
          .select({
            poseAssetId: schema.poseGarmentConfigs.poseAssetId,
            workflowTemplateId: schema.poseGarmentConfigs.workflowTemplateId,
            isActive: schema.poseGarmentConfigs.isActive,
            upperNodeIds: schema.workflowTemplates.upperNodeIds,
            lowerNodeId: schema.workflowTemplates.lowerNodeId,
            shoeNodeId: schema.workflowTemplates.shoeNodeId,
            accessoryNodeId: schema.workflowTemplates.accessoryNodeId,
            sizeNodeIds: schema.workflowTemplates.sizeNodeIds,
            garmentView: schema.workflowTemplates.garmentView,
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
        // Only override lower/shoe/size when the config row actually has a workflow
        // override set — a prompt-only override (no workflowTemplateId) must fall back
        // to the pose's own default workflow instead of wiping out hasLower/hasShoes.
        configMap = new Map(
          configs
            .filter((c) => c.workflowTemplateId != null)
            .map((c) => [
              c.poseAssetId,
              {
                upperNodeIds: c.upperNodeIds ?? null,
                lowerNodeId: c.lowerNodeId ?? null,
                shoeNodeId: c.shoeNodeId ?? null,
                accessoryNodeId: c.accessoryNodeId ?? null,
                sizeNodeIds: c.sizeNodeIds ?? null,
                garmentView: c.garmentView ?? 'front',
              },
            ]),
        );
        activeForType = new Set(
          configs.filter((c) => c.isActive !== false).map((c) => c.poseAssetId),
        );
      }

      return {
        items: await Promise.all(
          items
            .filter((i) => activeForType === null || activeForType.has(i.id))
            .map(async (i) => {
              const cfg = configMap.get(i.id);
              const upperNodeIds = cfg !== undefined ? cfg.upperNodeIds : i.upperNodeIds;
              const lowerNodeId = cfg !== undefined ? cfg.lowerNodeId : i.lowerNodeId;
              const shoeNodeId = cfg !== undefined ? cfg.shoeNodeId : i.shoeNodeId;
              const accessoryNodeId = cfg !== undefined ? cfg.accessoryNodeId : i.accessoryNodeId;
              const sizeNodeIds = cfg !== undefined ? cfg.sizeNodeIds : i.sizeNodeIds;
              const garmentView = cfg !== undefined ? cfg.garmentView : i.garmentView;
              return {
                id: i.id,
                label: i.displayName ?? i.label,
                thumbnailUrl: (await app.storage.presignGet(i.thumbnailUrl, 3600)).url,
                ...poseGarmentRoles({ upperNodeIds, lowerNodeId, shoeNodeId, accessoryNodeId }),
                garmentView: garmentView ?? 'front',
                hasAspectRatio: (sizeNodeIds?.length ?? 0) > 0,
              };
            }),
        ),
      };
    },
  );

  app.get(
    '/v1/models/catalogue-templates',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']),
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) =>
      listCatalogueTemplates(app, req.query as { gender: string; garmentTypeId?: string }),
  );
}
