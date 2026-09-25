import { schema } from '@aivastra/db';
import { type AnyColumn, and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface FacetList {
  values: string[];
  truncated: boolean;
}

export interface ProductFacets {
  productTypes: FacetList;
  vendors: FacetList;
  tags: FacetList;
  collections: FacetList;
  categories: FacetList;
}

const DEFAULT_CAP = 200;

/**
 * Distinct values for the merchant's filter dropdowns. Each list is fetched
 * with LIMIT cap+1 so "there were more" is known without a second count query;
 * the extra row is dropped before returning.
 */
export async function loadProductFacets(
  app: FastifyInstance,
  storeId: string,
  cap = DEFAULT_CAP,
): Promise<ProductFacets> {
  const t = schema.shopifyProductGarments;
  // Deleted rows are gone from the merchant's catalog — offering their tags or
  // types as filters would lead to dropdown options that match nothing.
  const live = and(eq(t.storeId, storeId), ne(t.status, 'deleted'));

  const finish = (rows: Array<{ v: string | null }>): FacetList => {
    const values = rows.map((r) => r.v).filter((v): v is string => !!v);
    return { values: values.slice(0, cap), truncated: values.length > cap };
  };

  const scalar = async (column: AnyColumn) =>
    finish(
      await app.db
        .selectDistinct({ v: sql<string | null>`${column}` })
        .from(t)
        .where(and(live, isNotNull(column), ne(column, '')))
        // Wrapped in sql`` because orderBy's overloads reject a bare AnyColumn.
        .orderBy(sql`${column}`)
        .limit(cap + 1),
    );

  const array = async (column: AnyColumn) =>
    finish(
      await app.db
        .selectDistinct({ v: sql<string | null>`unnest(${column})`.as('v') })
        .from(t)
        .where(and(live, isNotNull(column)))
        .orderBy(sql`v`)
        .limit(cap + 1),
    );

  const [productTypes, vendors, categories, tags, collections] = await Promise.all([
    scalar(t.productType),
    scalar(t.vendor),
    scalar(t.category),
    array(t.tags),
    array(t.collections),
  ]);
  return { productTypes, vendors, tags, collections, categories };
}
