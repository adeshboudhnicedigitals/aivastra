import { schema } from '@aivastra/db';
import type { KioskCatalogListResponse } from '@aivastra/types';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { loadDemoItems, loadDemoSubcategories } from '../merchant/demo-catalog-read.js';

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

    const own = await Promise.all(
      rows.map((row) => serializeCatalogItem(app, row.item, row.subcategory)),
    );
    // Same demo set the merchant-token surface sees, reshaped to the kiosk contract.
    const demo = await loadDemoItems(app, merchantId);
    const demoSubcategories = await loadDemoSubcategories(app, merchantId);
    const nameBySubcategory = new Map(demoSubcategories.map((s) => [s.id, s]));

    return {
      items: [
        ...own,
        ...demo.map((item) => {
          const sub = nameBySubcategory.get(item.subcategoryId);
          return {
            id: item.id,
            label: item.label,
            sku: item.sku,
            gender: (sub?.category ??
              'women') as KioskCatalogListResponse['items'][number]['gender'],
            category: sub?.name ?? 'Demo',
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl,
          } satisfies KioskCatalogListResponse['items'][number];
        }),
      ],
    };
  });
}
