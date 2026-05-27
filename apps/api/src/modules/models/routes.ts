import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';


export async function modelsRoutes(app: FastifyInstance) {
  app.get('/v1/models/subcategories', {
    preHandler: app.requireUser,
    schema: { querystring: z.object({ gender: z.enum(['men', 'women', 'boys', 'girls']) }) },
  }, async (req) => {
    const { gender } = req.query as { gender: string };
    const items = await app.db
      .select({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug, label: schema.garmentSubcategories.label, sortOrder: schema.garmentSubcategories.sortOrder, thumbnailKey: schema.garmentSubcategories.thumbnailKey })
      .from(schema.garmentSubcategories)
      .where(and(eq(schema.garmentSubcategories.genderSlug, gender), eq(schema.garmentSubcategories.isActive, true)));
    return {
      items: items.map((i) => ({
        ...i,
        thumbnailUrl: i.thumbnailKey ? app.storage.publicUrl(i.thumbnailKey) : null,
      })),
    };
  });

  app.get('/v1/models/faces', {
    preHandler: app.requireUser,
    schema: { querystring: z.object({ gender: z.enum(['men', 'women', 'boys', 'girls']) }) },
  }, async (req) => {
    const { gender } = req.query as { gender: string };
    const items = await app.db
      .select({ id: schema.modelFaces.id, gender: schema.modelFaces.gender, label: schema.modelFaces.label, thumbnailUrl: schema.modelFaces.thumbnailKey })
      .from(schema.modelFaces)
      .where(and(eq(schema.modelFaces.gender, gender), eq(schema.modelFaces.isActive, true)));
    return {
      items: items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl) })),
    };
  });

  app.get('/v1/models/backgrounds', {
    preHandler: app.requireUser,
    schema: { querystring: z.object({
      faceId: z.string().uuid().optional(),
      subcategoryId: z.string().uuid().optional(),
    }) },
  }, async (req) => {
    const { faceId, subcategoryId } = req.query as { faceId?: string; subcategoryId?: string };

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

      // When subcategoryId is known, fetch template pose thumbs for face × bg × subcategory
      // so the card shows the composite model preview instead of the raw background
      let templateMap = new Map<string, string>(); // backgroundId → thumbnailKey
      if (subcategoryId) {
        const templates = await app.db
          .select({
            backgroundId: schema.modelPoses.backgroundId,
            thumbnailKey: schema.modelPoses.thumbnailKey,
          })
          .from(schema.modelPoses)
          .where(and(
            eq(schema.modelPoses.subcategoryId, subcategoryId),
            eq(schema.modelPoses.faceId, faceId),
            eq(schema.modelPoses.isTemplate, true),
          ));
        templateMap = new Map(templates.map((t) => [t.backgroundId, t.thumbnailKey]));
      }

      return {
        items: backs.map((b) => {
          const tmplKey = templateMap.get(b.id);
          return {
            id: b.id,
            label: b.label,
            thumbnailUrl: app.storage.publicUrl(b.thumbnailKey),
            previewUrl: app.storage.publicUrl(tmplKey ?? b.thumbnailKey),
          };
        }),
      };
    }

    const rows = await app.db
      .select({ id: schema.modelBackgrounds.id, label: schema.modelBackgrounds.label, thumbnailKey: schema.modelBackgrounds.thumbnailKey })
      .from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.isActive, true));
    return {
      items: rows.map((i) => ({
        id: i.id,
        label: i.label,
        thumbnailUrl: app.storage.publicUrl(i.thumbnailKey),
        previewUrl: app.storage.publicUrl(i.thumbnailKey),
      })),
    };
  });

  app.get('/v1/models/poses', {
    preHandler: app.requireUser,
    schema: {
      querystring: z.object({
        subcategoryId: z.string().uuid(),
        faceId: z.string().uuid(),
        backgroundId: z.string().uuid(),
      }),
    },
  }, async (req) => {
    const { subcategoryId, faceId, backgroundId } = req.query as { subcategoryId: string; faceId: string; backgroundId: string };
    const items = await app.db
      .select({ id: schema.modelPoses.id, label: schema.modelPoses.label, thumbnailUrl: schema.modelPoses.thumbnailKey, showsLower: schema.modelPoses.showsLower, showsShoes: schema.modelPoses.showsShoes })
      .from(schema.modelPoses)
      .where(
        and(
          eq(schema.modelPoses.subcategoryId, subcategoryId),
          eq(schema.modelPoses.faceId, faceId),
          eq(schema.modelPoses.backgroundId, backgroundId),
          eq(schema.modelPoses.isActive, true),
        ),
      );
    return {
      items: items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl) })),
    };
  });
}
