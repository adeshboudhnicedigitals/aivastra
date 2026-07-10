import { schema } from '@aivastra/db';
import type { KioskCatalogListResponse } from '@aivastra/types';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

type MerchantCatalogRow = typeof schema.merchantCatalogItems.$inferSelect;
type SubcategoryRow = Pick<
  typeof schema.merchantCatalogSubcategories.$inferSelect,
  'category' | 'name'
>;

async function serializeCatalogItem(
  app: FastifyInstance,
  item: MerchantCatalogRow,
  subcategory: SubcategoryRow,
) {
  const [imageUrl, thumbnailUrl] = await Promise.all([
    app.storage
      .presignGet(item.r2Key, 86_400)
      .then((result) => result.url)
      .catch(() => null),
    app.storage
      .presignGet(item.thumbnailKey, 86_400)
      .then((result) => result.url)
      .catch(() => null),
  ]);

  return {
    id: item.id,
    label: item.label,
    sku: item.sku,
    gender: subcategory.category as KioskCatalogListResponse['items'][number]['gender'],
    category: subcategory.name,
    imageUrl,
    thumbnailUrl,
  } satisfies KioskCatalogListResponse['items'][number];
}

export async function kioskCatalogRoutes(app: FastifyInstance) {
  app.get('/v1/kiosk/catalog', { preHandler: app.requireKioskDevice }, async (req) => {
    const merchantId = req.merchantClientId;
    if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const rows = await app.db
      .select({
        item: schema.merchantCatalogItems,
        subcategory: {
          category: schema.merchantCatalogSubcategories.category,
          name: schema.merchantCatalogSubcategories.name,
        },
      })
      .from(schema.merchantCatalogItems)
      .innerJoin(
        schema.merchantCatalogSubcategories,
        eq(schema.merchantCatalogItems.subcategoryId, schema.merchantCatalogSubcategories.id),
      )
      .where(
        and(
          eq(schema.merchantCatalogItems.merchantId, merchantId),
          eq(schema.merchantCatalogItems.isActive, true),
          eq(schema.merchantCatalogItems.moderationStatus, 'approved'),
        ),
      )
      .orderBy(schema.merchantCatalogItems.sortOrder, desc(schema.merchantCatalogItems.createdAt));

    return {
      items: await Promise.all(
        rows.map((row) => serializeCatalogItem(app, row.item, row.subcategory)),
      ),
    };
  });
}
