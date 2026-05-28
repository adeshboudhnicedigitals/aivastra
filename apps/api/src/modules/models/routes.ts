import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
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
          // When provided, only return faces that have ≥1 active pose for this garment type.
          // Without this filter, all faces for the gender are shown even if they have no
          // poses for the selected garment type — the root cause of the filtering bug.
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { gender, garmentTypeId } = req.query as { gender: string; garmentTypeId?: string };

      const cols = {
        id: schema.modelFaces.id,
        gender: schema.modelFaces.gender,
        label: schema.modelFaces.label,
        thumbnailUrl: schema.modelFaces.thumbnailKey,
      };

      const items = garmentTypeId
        ? await app.db
            .selectDistinct(cols)
            .from(schema.modelFaces)
            .innerJoin(
              schema.modelPoses,
              and(
                eq(schema.modelPoses.faceId, schema.modelFaces.id),
                eq(schema.modelPoses.subcategoryId, garmentTypeId),
                eq(schema.modelPoses.isActive, true),
              ),
            )
            .where(and(eq(schema.modelFaces.gender, gender), eq(schema.modelFaces.isActive, true)))
        : await app.db
            .select(cols)
            .from(schema.modelFaces)
            .where(and(eq(schema.modelFaces.gender, gender), eq(schema.modelFaces.isActive, true)));

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
          faceId: z.string().uuid().optional(),
          garmentTypeId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      const { faceId, garmentTypeId } = req.query as { faceId?: string; garmentTypeId?: string };

      if (faceId) {
        // Backgrounds that have ≥1 active pose for this face
        const backs = await app.db
          .selectDistinct({
            id: schema.modelBackgrounds.id,
            label: schema.modelBackgrounds.label,
            thumbnailKey: schema.modelBackgrounds.thumbnailKey,
          })
          .from(schema.modelBackgrounds)
          .innerJoin(
            schema.modelPoses,
            and(
              eq(schema.modelPoses.backgroundId, schema.modelBackgrounds.id),
              eq(schema.modelPoses.faceId, faceId),
              eq(schema.modelPoses.isActive, true),
            ),
          )
          .where(eq(schema.modelBackgrounds.isActive, true));

        // When garmentTypeId is known, fetch template pose thumbs for face × bg × garment type
        // so the card shows the composite model preview instead of the raw background
        let templateMap = new Map<string, string>(); // backgroundId → thumbnailKey
        if (garmentTypeId) {
          const templates = await app.db
            .select({
              backgroundId: schema.modelPoses.backgroundId,
              thumbnailKey: schema.modelPoses.thumbnailKey,
            })
            .from(schema.modelPoses)
            .where(
              and(
                eq(schema.modelPoses.subcategoryId, garmentTypeId),
                eq(schema.modelPoses.faceId, faceId),
                eq(schema.modelPoses.isTemplate, true),
              ),
            );
          templateMap = new Map(templates.map((t) => [t.backgroundId, t.thumbnailKey]));
        }

        return {
          items: backs.map((b) => ({
            id: b.id,
            label: b.label,
            thumbnailUrl: app.storage.publicUrl(b.thumbnailKey),
            previewUrl: app.storage.publicUrl(templateMap.get(b.id) ?? b.thumbnailKey),
          })),
        };
      }

      const rows = await app.db
        .select({
          id: schema.modelBackgrounds.id,
          label: schema.modelBackgrounds.label,
          thumbnailKey: schema.modelBackgrounds.thumbnailKey,
        })
        .from(schema.modelBackgrounds)
        .where(eq(schema.modelBackgrounds.isActive, true));

      return {
        items: rows.map((b) => ({
          id: b.id,
          label: b.label,
          thumbnailUrl: app.storage.publicUrl(b.thumbnailKey),
          previewUrl: app.storage.publicUrl(b.thumbnailKey),
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
          faceId: z.string().uuid(),
          backgroundId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      const { garmentTypeId, faceId, backgroundId } = req.query as {
        garmentTypeId: string;
        faceId: string;
        backgroundId: string;
      };
      const items = await app.db
        .select({
          id: schema.modelPoses.id,
          label: schema.modelPoses.label,
          thumbnailUrl: schema.modelPoses.thumbnailKey,
          showsLower: schema.modelPoses.showsLower,
          showsShoes: schema.modelPoses.showsShoes,
        })
        .from(schema.modelPoses)
        .where(
          and(
            eq(schema.modelPoses.subcategoryId, garmentTypeId),
            eq(schema.modelPoses.faceId, faceId),
            eq(schema.modelPoses.backgroundId, backgroundId),
            eq(schema.modelPoses.isActive, true),
          ),
        );
      return {
        items: items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl) })),
      };
    },
  );
}
