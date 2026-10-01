import { schema } from '@aivastra/db';
import { type AnyColumn, and, eq, ilike, inArray, ne, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

const stringList = z.array(z.string().min(1)).max(50);

/**
 * Body form of the product filter (the bulk endpoint's JSON). Arrays are real
 * arrays and booleans are real booleans. Everything is optional; an empty
 * filter means "every non-deleted product in the store".
 */
export const ProductFilterSchema = z.object({
  q: z.string().optional(),
  status: z.enum(['active', 'processing', 'failed', 'deleted']).optional(),
  enabled: z.boolean().optional(),
  excluded: z.boolean().optional(),
  productType: stringList.optional(),
  vendor: stringList.optional(),
  tag: stringList.optional(),
  collection: stringList.optional(),
  category: stringList.optional(),
});
export type ProductFilter = z.infer<typeof ProductFilterSchema>;

const queryBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// A repeated query param (`?tag=a&tag=b`) arrives as an array, a single one as
// a bare string — normalise both to an array so the builder sees one shape.
const queryList = z
  .union([z.string().min(1), z.array(z.string().min(1)).max(50)])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

/** Query-string form: the same fields as ProductFilter plus pagination. */
export const ProductListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  status: z.enum(['active', 'processing', 'failed', 'deleted']).optional(),
  enabled: queryBoolean,
  excluded: queryBoolean,
  productType: queryList,
  vendor: queryList,
  tag: queryList,
  collection: queryList,
  category: queryList,
});

// `col && ARRAY[...]::text[]` — true when the row's array shares any element
// with the given values, which is the OR-within-a-filter semantics the UI shows.
function overlaps(column: AnyColumn, values: string[]): SQL {
  return sql`${column} && ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * The single definition of "which products does this filter select". The list
 * route and the bulk route both go through it, so "Select all N matching" acts
 * on exactly the rows the merchant was looking at. Always scoped to the store.
 */
export function buildProductFilter(storeId: string, f: ProductFilter): SQL {
  const t = schema.shopifyProductGarments;
  const conditions: SQL[] = [
    eq(t.storeId, storeId),
    f.status ? eq(t.status, f.status) : ne(t.status, 'deleted'),
  ];
  if (f.enabled !== undefined) conditions.push(eq(t.enabled, f.enabled));
  if (f.excluded !== undefined) conditions.push(eq(t.excluded, f.excluded));
  if (f.q) {
    // Escape LIKE metacharacters so "100%" searches for a literal percent sign.
    const literal = f.q.replace(/[\\%_]/g, '\\$&');
    conditions.push(ilike(t.title, `%${literal}%`));
  }
  if (f.productType?.length) conditions.push(inArray(t.productType, f.productType));
  if (f.vendor?.length) conditions.push(inArray(t.vendor, f.vendor));
  if (f.category?.length) conditions.push(inArray(t.category, f.category));
  if (f.tag?.length) conditions.push(overlaps(t.tags, f.tag));
  if (f.collection?.length) conditions.push(overlaps(t.collections, f.collection));
  return and(...conditions) as SQL;
}
