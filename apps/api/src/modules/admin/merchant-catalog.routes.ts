import { schema } from '@aivastra/db';
import { AdminMerchantCatalogUpdateBody } from '@aivastra/types';
import { and, desc, eq, ilike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

type MerchantCatalogRow = typeof schema.merchantCatalogItems.$inferSelect;

async function serializeCatalogItem(app: FastifyInstance, item: MerchantCatalogRow) {
  const [imageUrl, thumbnailUrl] = await Promise.all([
    app.storage
      .presignGet(item.r2Key, 3600)
      .then((result) => result.url)
      .catch(() => null),
    app.storage
      .presignGet(item.thumbnailKey, 3600)
      .then((result) => result.url)
      .catch(() => null),
  ]);

  return {
    ...item,
    imageUrl,
    thumbnailUrl,
    sourceKind: item.sourceJobId ? ('imported' as const) : ('uploaded' as const),
  };
}

export async function adminMerchantCatalogRoutes(app: FastifyInstance) {
  app.get(
    '/admin/merchant-catalog',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const { widgetClientId, search = '' } = req.query as {
        widgetClientId?: string;
        search?: string;
      };

      const filters = [];
      if (widgetClientId) {
        filters.push(eq(schema.merchantCatalogItems.widgetClientId, widgetClientId));
      }
      if (search.trim()) {
        filters.push(ilike(schema.merchantCatalogItems.label, `%${search.trim()}%`));
      }

      const items = await app.db
        .select()
        .from(schema.merchantCatalogItems)
        .where(filters.length > 1 ? and(...filters) : filters[0])
        .orderBy(desc(schema.merchantCatalogItems.createdAt))
        .limit(200);

      return { items: await Promise.all(items.map((item) => serializeCatalogItem(app, item))) };
    },
  );

  app.patch(
    '/admin/merchant-catalog/:id',
    {
      preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AdminMerchantCatalogUpdateBody,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof AdminMerchantCatalogUpdateBody>;

      const [updated] = await app.db
        .update(schema.merchantCatalogItems)
        .set({
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.moderationStatus !== undefined
            ? { moderationStatus: body.moderationStatus }
            : {}),
          ...(body.moderationNote !== undefined ? { moderationNote: body.moderationNote } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.merchantCatalogItems.id, id))
        .returning();

      if (!updated) throw new AppError('NOT_FOUND', 404, 'catalog item not found');
      return serializeCatalogItem(app, updated);
    },
  );
}
