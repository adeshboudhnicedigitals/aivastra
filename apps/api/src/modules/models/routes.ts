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
      .select({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug, label: schema.garmentSubcategories.label, sortOrder: schema.garmentSubcategories.sortOrder })
      .from(schema.garmentSubcategories)
      .where(and(eq(schema.garmentSubcategories.genderSlug, gender), eq(schema.garmentSubcategories.isActive, true)));
    return { items };
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
    schema: { querystring: z.object({ faceId: z.string().uuid().optional() }) },
  }, async (req) => {
    const { faceId } = req.query as { faceId?: string };
    let items: { id: string; label: string; thumbnailUrl: string }[];

    if (faceId) {
      // Only return backgrounds that have ≥1 active pose for this face (3D tensor: bg ⊂ face)
      items = await app.db
        .selectDistinct({
          id: schema.modelBackgrounds.id,
          label: schema.modelBackgrounds.label,
          thumbnailUrl: schema.modelBackgrounds.thumbnailKey,
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
    } else {
      items = await app.db
        .select({ id: schema.modelBackgrounds.id, label: schema.modelBackgrounds.label, thumbnailUrl: schema.modelBackgrounds.thumbnailKey })
        .from(schema.modelBackgrounds)
        .where(eq(schema.modelBackgrounds.isActive, true));
    }

    return { items: items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailUrl) })) };
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
