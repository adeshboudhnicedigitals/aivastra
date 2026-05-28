import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildTree } from './tree.js';

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/v1/catalog/:type', {
    preHandler: app.requireUser,
    schema: {
      params: z.object({ type: z.enum(['lower', 'shoe']) }),
      querystring: z.object({ gender: z.enum(['women', 'men', 'girls', 'boys']).optional() }),
    },
  }, async (req) => {
    const { type } = req.params as { type: string };
    const { gender } = req.query as { gender?: string };
    const [t] = await app.db.select().from(schema.catalogTypes).where(eq(schema.catalogTypes.slug, type));
    if (!t) throw new AppError('NOT_FOUND', 404, 'unknown catalog type');

    let catQuery = app.db.select().from(schema.catalogCategories)
      .where(and(eq(schema.catalogCategories.typeId, t.id), eq(schema.catalogCategories.isActive, true)));
    const allCats = await catQuery;

    // filter to the gender slug prefix when requested
    const cats = gender
      ? allCats.filter((c) => c.slug.startsWith(`${gender}-`))
      : allCats;

    const catIds = new Set(cats.map((c) => c.id));
    const allItems = await app.db.select().from(schema.catalogItems)
      .where(eq(schema.catalogItems.isActive, true));
    const items = allItems.filter((i) => i.categoryId != null && catIds.has(i.categoryId));
    const enriched = items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailKey) }));
    return { type, tree: buildTree(cats, enriched) };
  });
}
