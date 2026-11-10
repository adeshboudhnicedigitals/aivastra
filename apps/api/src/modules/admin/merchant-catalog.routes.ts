import { schema } from '@aivastra/db';
import { AdminMerchantCatalogUpdateBody } from '@aivastra/types';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from './guard.js';

type MerchantCatalogRow = typeof schema.merchantCatalogItems.$inferSelect;

async function serializeCatalogItem(app: FastifyInstance, fullItem: MerchantCatalogRow) {
  // Same response shape as before the staff soft-delete columns existed.
  const {
    deletedAt: _deletedAt,
    deletedByStaffId: _deletedByStaffId,
    updatedByStaffId: _updatedByStaffId,
    ...item
  } = fullItem;
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

  return { ...item, imageUrl, thumbnailUrl };
}

export async function adminMerchantCatalogRoutes(app: FastifyInstance) {
  const GUARD = requirePermission('merchant_catalog.manage');

  app.get('/admin/merchant-catalog', { preHandler: GUARD }, async (req) => {
    const { merchantId, search = '' } = req.query as {
      merchantId?: string;
      search?: string;
    };

    // Staff soft-deleted items are hidden from moderation like every merchant-facing read.
    const filters = [isNull(schema.merchantCatalogItems.deletedAt)];
    if (merchantId) {
      filters.push(eq(schema.merchantCatalogItems.merchantId, merchantId));
    }
    if (search.trim()) {
      filters.push(ilike(schema.merchantCatalogItems.label, `%${search.trim()}%`));
    }

    const items = await app.db
      .select()
      .from(schema.merchantCatalogItems)
      .where(and(...filters))
      .orderBy(desc(schema.merchantCatalogItems.createdAt))
      .limit(200);

    return { items: await Promise.all(items.map((item) => serializeCatalogItem(app, item))) };
  });

  app.patch(
    '/admin/merchant-catalog/:id',
    {
      preHandler: GUARD,
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
