import { schema } from '@aivastra/db';
import { computePixverseVideoCost, type PixverseQuality } from '@aivastra/types';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isCatalogVideoAllowed } from '../../lib/catalog-video-access.js';
import { AppError } from '../../lib/errors.js';
import { getPixverseVideoPricingConfig } from '../../lib/resolution-config.js';
import {
  listBackgrounds,
  listBlouseCategories,
  listCatalogueTemplates,
  listFaces,
  listGarmentTypes,
  listPoses,
} from './queries.js';

export async function modelsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/models/body-types',
    {
      preHandler: app.requireUserOrCatalogApp,
      schema: { querystring: z.object({ gender: z.enum(['men', 'women', 'boys', 'girls']) }) },
    },
    async (req) => {
      const { gender } = req.query as { gender: string };
      const items = await app.db
        .select({
          id: schema.bodyTypes.id,
          label: schema.bodyTypes.label,
          thumbnailKey: schema.bodyTypes.thumbnailKey,
        })
        .from(schema.bodyTypes)
        .where(
          and(
            eq(schema.bodyTypes.genderSlug, gender),
            eq(schema.bodyTypes.isActive, true),
            isNull(schema.bodyTypes.deletedAt),
          ),
        )
        .orderBy(asc(schema.bodyTypes.sortOrder), asc(schema.bodyTypes.label));
      return {
        items: await Promise.all(
          items.map(async (i) => ({
            ...i,
            thumbnailUrl: i.thumbnailKey
              ? (await app.storage.presignGet(i.thumbnailKey, 3600)).url
              : null,
          })),
        ),
      };
    },
  );

  app.get(
    '/v1/models/garment-types',
    {
      preHandler: app.requireUserOrCatalogApp,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']),
          bodyTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { gender, bodyTypeId } = req.query as { gender: string; bodyTypeId?: string };
      return listGarmentTypes(app, gender, bodyTypeId);
    },
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
          bodyTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) =>
      listFaces(app, req.query as { gender: string; garmentTypeId?: string; bodyTypeId?: string }),
  );

  app.get(
    '/v1/models/backgrounds',
    {
      preHandler: app.requireUser,
      schema: {
        querystring: z.object({
          gender: z.enum(['men', 'women', 'boys', 'girls']).optional(),
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { gender, garmentTypeId } = req.query as { gender?: string; garmentTypeId?: string };

      const rows = await listBackgrounds(app, gender, garmentTypeId);

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
          bodyTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { gender, garmentTypeId, bodyTypeId } = req.query as {
        gender: string;
        garmentTypeId?: string;
        bodyTypeId?: string;
      };
      return listPoses(app, { gender, garmentTypeId, bodyTypeId });
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

  app.get(
    '/v1/models/blouse-categories',
    {
      preHandler: app.requireUserOrCatalogApp,
      schema: {
        querystring: z.object({ garmentSubcategoryId: z.string().uuid().optional() }),
      },
    },
    async (req) => {
      const { garmentSubcategoryId } = req.query as { garmentSubcategoryId?: string };
      return listBlouseCategories(app, garmentSubcategoryId);
    },
  );
}
