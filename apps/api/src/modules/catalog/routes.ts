import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { buildTree } from './tree';

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/v1/catalog/:type', {
    preHandler: app.requireUser,
    schema: { params: z.object({ type: z.enum(['models', 'poses', 'backgrounds', 'lower', 'shoes']) }) },
  }, async (req) => {
    const { type } = req.params as { type: string };
    const [t] = await app.db.select().from(schema.catalogTypes).where(eq(schema.catalogTypes.slug, type));
    if (!t) throw new AppError('NOT_FOUND', 404, 'unknown catalog type');
    const cats = await app.db.select().from(schema.catalogCategories)
      .where(and(eq(schema.catalogCategories.typeId, t.id), eq(schema.catalogCategories.isActive, true)));
    const items = await app.db.select().from(schema.catalogItems)
      .where(eq(schema.catalogItems.isActive, true));
    const enriched = items.map((i) => ({ ...i, thumbnailUrl: app.storage.publicUrl(i.thumbnailKey) }));
    return { type, tree: buildTree(cats, enriched) };
  });
}
