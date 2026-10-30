import { schema } from '@aivastra/db';
import { and, eq, exists, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * The active catalog items of one type the studio offers for a gender and,
 * when given, a garment type. Shared by /v1/catalog/:type and the WhatsApp bot,
 * which draws a lower and a shoe at random from it.
 *
 * `categorizedOnly` keeps just the items whose category is active. The studio
 * shows exactly that set: its route folds items in an inactive (or no) category
 * into an "Other" node and the page discards that node client-side. The route
 * does not pass it, because it builds that tree itself; the bot has no tree to
 * discard from, so it asks for the filter here.
 */
export async function selectCatalogItems(
  app: FastifyInstance,
  {
    type,
    gender,
    garmentTypeId,
    categorizedOnly = false,
  }: { type: string; gender?: string; garmentTypeId?: string; categorizedOnly?: boolean },
) {
  // Garment type determines the pose workflow. When a garment type has
  // explicit lower/shoe mappings configured via catalog_item_subcategories,
  // Studio picker narrows to those mapped items (plus the configured default).
  // If unconfigured, it offers every active lower garment or shoe for the selected gender.
  // Accessories are always strictly opt-in via catalog_item_subcategories.
  const conditions = [eq(schema.catalogItems.isActive, true), eq(schema.catalogItems.type, type)];
  if (gender) conditions.push(eq(schema.catalogItems.genderSlug, gender));
  if (categorizedOnly) {
    conditions.push(
      exists(
        app.db
          .select({ one: schema.catalogCategories.id })
          .from(schema.catalogCategories)
          .where(
            and(
              eq(schema.catalogCategories.id, schema.catalogItems.categoryId),
              eq(schema.catalogCategories.isActive, true),
            ),
          ),
      ),
    );
  }
  if (type === 'accessory' && garmentTypeId) {
    conditions.push(
      exists(
        app.db
          .select({ one: schema.catalogItemSubcategories.catalogItemId })
          .from(schema.catalogItemSubcategories)
          .where(
            and(
              eq(schema.catalogItemSubcategories.catalogItemId, schema.catalogItems.id),
              eq(schema.catalogItemSubcategories.subcategoryId, garmentTypeId),
            ),
          ),
      ),
    );
  } else if ((type === 'lower' || type === 'shoe') && garmentTypeId) {
    const [gt] = await app.db
      .select({
        defaultLowerCatalogId: schema.garmentSubcategories.defaultLowerCatalogId,
        defaultShoeCatalogId: schema.garmentSubcategories.defaultShoeCatalogId,
        explicitLowerMappingsConfigured:
          schema.garmentSubcategories.explicitLowerMappingsConfigured,
        explicitShoeMappingsConfigured: schema.garmentSubcategories.explicitShoeMappingsConfigured,
      })
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));

    // "Configured" is the persisted flag OR a mapped row actually existing —
    // never a bare row-count alone. The flag alone can't tell "never configured"
    // apart from "explicitly configured to zero" (see explicitLowerMappingsConfigured's
    // schema comment), which used to make unmapping every lower/shoe item for a
    // garment type silently revert the studio picker to "show everything"; a
    // row-count alone misses a type that was just unmapped down to zero. Checking
    // both means whichever one is true is trusted.
    const configuredFlag =
      type === 'lower' ? gt?.explicitLowerMappingsConfigured : gt?.explicitShoeMappingsConfigured;
    const [anyMappedRow] = await app.db
      .select({ one: schema.catalogItemSubcategories.catalogItemId })
      .from(schema.catalogItemSubcategories)
      .innerJoin(
        schema.catalogItems,
        eq(schema.catalogItems.id, schema.catalogItemSubcategories.catalogItemId),
      )
      .where(
        and(
          eq(schema.catalogItemSubcategories.subcategoryId, garmentTypeId),
          eq(schema.catalogItems.type, type),
        ),
      )
      .limit(1);
    const hasExplicitMappings = configuredFlag || Boolean(anyMappedRow);

    if (hasExplicitMappings) {
      const defaultId = type === 'lower' ? gt?.defaultLowerCatalogId : gt?.defaultShoeCatalogId;

      const isMapped = exists(
        app.db
          .select({ one: schema.catalogItemSubcategories.catalogItemId })
          .from(schema.catalogItemSubcategories)
          .where(
            and(
              eq(schema.catalogItemSubcategories.catalogItemId, schema.catalogItems.id),
              eq(schema.catalogItemSubcategories.subcategoryId, garmentTypeId),
            ),
          ),
      );

      const mappedCondition = defaultId
        ? or(isMapped, eq(schema.catalogItems.id, defaultId))
        : isMapped;
      if (mappedCondition) {
        conditions.push(mappedCondition);
      }
    }
  }

  return app.db
    .select()
    .from(schema.catalogItems)
    .where(and(...conditions));
}
