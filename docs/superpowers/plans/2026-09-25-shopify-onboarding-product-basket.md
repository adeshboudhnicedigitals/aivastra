# Shopify Onboarding — Product Selection and Basket Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace onboarding's "sync everything + optional rule" pages with one two-stage page where the merchant picks products (search + filters) and then assigns baskets (one for all, overridable per product).

**Architecture:** The API gains shared product filters, a facets endpoint, a transactional bulk-update endpoint, a `category` column, and an `unroutedEnabledCount` on `/me`. The Shopify SPA derives wizard progress from live `/me` data (no new flag), and page 2 renders a selection stage or a basket stage depending on that data, inside the existing `OnboardingShell` footer.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle ORM (postgres-js), PostgreSQL 16, Vitest, React 18 + Polaris 13 + react-router-dom, Vite.

**Spec:** `docs/superpowers/specs/2026-09-25-shopify-onboarding-product-basket-design.md`. Two refinements made while planning, both reflected back into the spec in Task 10: the facets response is `{ values, truncated }` per list, and the page-2 stage is derived from `/me` data instead of a URL param (a reload keeps the stage either way).

## Global Constraints

- **Never** run `pnpm db:generate`, drizzle-kit snapshot changes, `psql` or `tsx` data fixes against production or `tryon_prod`. Generate the migration locally; it ships through push → CI → `db:migrate:prod` (CLAUDE.md, "Production safety").
- API source is ESM: relative imports end in `.js` (`'./products.filter.js'`). Import the DB as `import { schema } from '@aivastra/db'` and Drizzle operators from `drizzle-orm`. No `console.log` in committed code (pino only).
- Dropdowns in `apps/shopify` use Polaris `Select` / `ChoiceList`, never a raw `<select>`.
- Errors in the SPA go through `classifyError` + the shared `ErrorBanner`; no silent catches.
- Comments explain the *why*, matching the surrounding file.
- Product IDs are `bigint` columns read as JS `number`; store scoping (`store_id`) is mandatory on every query, including bulk updates.
- **Commits:** CLAUDE.md forbids committing unless the user asked. Every "Commit" step below applies **only if the user has asked for commits**; otherwise leave the changes in the working tree and move on. When committing, end the message with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Tasks 6–9 change one user-visible flow; do not deploy between them.
- Docker services must be up for API tests: `pnpm docker:up`.
- Run API tests from the repo root with `pnpm --filter @aivastra/api exec vitest run <file>`; run SPA tests with `pnpm --filter @aivastra/shopify-admin exec vitest run <file>`.

## Review Focus

Inputs the spec implies but the happy-path tests would not exercise, most likely to bite first. Each has a test in the task that owns the code.

1. **Search text containing `%` or `_`** (e.g. "100% cotton") must match literally, not act as a SQL wildcard — Task 2.
2. **"Select all N matching" followed by a filter change or a deselect** must not enable products the merchant never saw: changing the filter drops the "all" selection, and deselecting a row while in "all" mode adds it to `excludeIds` — Tasks 4 and 7.
3. **Product ids or filters that belong to another store** must update nothing (`updated: 0`) — Task 4.
4. **A store with zero products after sync** must show an empty state with a retry, and must not re-trigger sync in a loop — Task 9.
5. **A legacy store already in global mode, or a basket deactivated between page load and "Apply to all"**: stage 2 must still list products (global mode means `enabled` is not the right filter), and a stale basket must return `404` with nothing changed — Tasks 4 and 9.

---

## File Structure

**API (`apps/api`)**
- Create `src/modules/shopify/products.filter.ts` — the one place product filters are defined: zod schemas (query form and body form) and `buildProductFilter`.
- Create `src/modules/shopify/products.facets.ts` — `loadProductFacets`.
- Create `src/modules/shopify/products.bulk.ts` — `BulkBodySchema`, `bulkUpdateProducts`.
- Modify `src/modules/shopify/products.routes.ts` — use the shared filter, return the new fields, register `GET /products/facets` and `POST /products/bulk`.
- Modify `src/modules/shopify/products.sync.ts` — fetch and store `category`.
- Modify `src/modules/shopify/me.routes.ts` — add `stats.unroutedEnabledCount`.
- Create tests `test/shopify-products-filter.test.ts`, `test/shopify-products-bulk.test.ts`; modify `test/shopify-sync.test.ts`, `test/shopify-me.test.ts`.

**DB (`packages/db`)**
- Modify `src/schema/shopify.ts` — `category` column. New generated migration under `src/migrations/`.

**SPA (`apps/shopify/src`)**
- Modify `types.ts`, `lib/onboarding.ts` (+ `lib/onboarding.test.ts`), `App.tsx`, `components/OnboardingLayout.tsx`, `pages/OnboardingProductsPage.tsx`.
- Delete `pages/OnboardingRoutingPage.tsx`.
- Create `lib/products.ts` (+ test), `lib/productSelection.ts` (+ test).
- Create `components/onboarding/ProductSelectionStage.tsx`, `components/onboarding/BasketAssignmentStage.tsx`.

---

### Task 1: `category` column and sync

**Files:**
- Modify: `packages/db/src/schema/shopify.ts` (the `shopifyProductGarments` table, next to `vendor`)
- Create: generated migration in `packages/db/src/migrations/`
- Modify: `apps/api/src/modules/shopify/products.sync.ts`
- Test: `apps/api/test/shopify-sync.test.ts`

**Interfaces:**
- Produces: column `schema.shopifyProductGarments.category: string | null`; `ShopifyProduct.category?: string | null`. Later tasks read `category` from the table.

- [ ] **Step 1: Write the failing test**

Append to the `describe('syncProduct', ...)` block in `apps/api/test/shopify-sync.test.ts` (it reuses the file's `app`, `storeId` and imports):

```ts
  it('stores the product category, and clears it when Shopify stops reporting one', async () => {
    await syncProduct(
      app,
      storeId,
      {
        id: 90,
        title: 'Categorised',
        imageUrl: 'https://cdn.shopify.com/x.jpg',
        category: 'Apparel & Accessories > Clothing > Dresses',
      },
      mockFetch,
    );
    const read = async () => {
      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 90),
          ),
        );
      return row;
    };
    expect((await read()).category).toBe('Apparel & Accessories > Clothing > Dresses');

    await syncProduct(
      app,
      storeId,
      { id: 90, title: 'Categorised', imageUrl: 'https://cdn.shopify.com/x.jpg' },
      mockFetch,
    );
    expect((await read()).category).toBeNull();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-sync.test.ts`
Expected: FAIL — TypeScript/Drizzle rejects `category` (no such column / property).

- [ ] **Step 3: Add the column**

In `packages/db/src/schema/shopify.ts`, in `shopifyProductGarments`, after the `vendor` line:

```ts
    // Shopify's standard product category (taxonomy `fullName`, e.g.
    // "Apparel & Accessories > Clothing > Dresses") — distinct from the
    // free-text productType above. Null until a sync after this column existed.
    category: text('category'),
```

- [ ] **Step 4: Generate the migration locally**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0205_*.sql` plus updated `meta/` snapshot and journal. Open the SQL and confirm it contains only:

```sql
ALTER TABLE "shopify_product_garments" ADD COLUMN "category" text;
```

If it contains anything else, stop and investigate — do not hand-edit snapshots. Do **not** run any migrate command against production.

- [ ] **Step 4b: Apply it to your local database**

Run: `pnpm db:migrate` (uses `DATABASE_URL` from your local `.env`; confirm it points at localhost before running).

- [ ] **Step 5: Teach the sync about category**

In `apps/api/src/modules/shopify/products.sync.ts`:

`ShopifyProduct` interface — add after `collections`:

```ts
  category?: string | null;
```

`PRODUCT_FIELDS` — add a line before the closing backtick:

```ts
  category { fullName }
```

`GraphQLProductNode` — add:

```ts
  category?: { fullName?: string | null } | null;
```

`toShopifyProduct` — add to the returned object:

```ts
    category: node.category?.fullName || null,
```

`upsertGarment` — add a `category: string | null,` parameter **before** `failedReason?`, add `category,` to both the `.values({...})` object and the `onConflictDoUpdate` `set: {...}` object (so a later sync that returns no category clears it).

In `syncProduct`, add `const category = product.category ?? null;` next to the other destructured fields, and pass `category` as the argument right after `collections` in **every** `upsertGarment(...)` call — there are three, all in `syncProduct` (the no-image branch, the `'active'` branch, and the `'failed'` catch branch). Run `git grep -n "upsertGarment("` to confirm there are no others; the compiler will also flag any call that is missing the new argument.

- [ ] **Step 6: Run the test and typecheck**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-sync.test.ts`
Expected: PASS (all tests in the file).
Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors.

- [ ] **Step 7: Commit (only if the user asked for commits)**

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations apps/api/src/modules/shopify/products.sync.ts apps/api/test/shopify-sync.test.ts
git commit -m "feat(shopify): store Shopify product category on synced products"
```

---

### Task 2: Shared product filter and list route

**Files:**
- Create: `apps/api/src/modules/shopify/products.filter.ts`
- Modify: `apps/api/src/modules/shopify/products.routes.ts` (imports, `ProductsQuery`, the `GET /v1/shopify/products` handler)
- Test: `apps/api/test/shopify-products-filter.test.ts`

**Interfaces:**
- Produces (used by Tasks 3 and 4):
  ```ts
  export const ProductFilterSchema: z.ZodObject<...>;        // body form: arrays are real arrays, booleans are real booleans
  export type ProductFilter = z.infer<typeof ProductFilterSchema>;
  export const ProductListQuerySchema: z.ZodObject<...>;     // query-string form; transforms into ProductFilter fields + page/pageSize
  export function buildProductFilter(storeId: string, filter: ProductFilter): SQL;
  ```
- Response items of `GET /v1/shopify/products` gain `productType: string|null`, `vendor: string|null`, `tags: string[]|null`, `collections: string[]|null`, `category: string|null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/shopify-products-filter.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 13).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

let c: Containers;
let app: TestApp;
let storeId: string;
let auth: { authorization: string };
let otherAuth: { authorization: string };

async function makeStore(shopifyShopId: number, domain: string) {
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId,
      shopDomain: domain,
      myshopifyDomain: domain,
      name: domain,
      email: `owner@${domain}`,
    },
    'tok',
    'read_products',
  );
  return {
    store,
    headers: { authorization: `Bearer ${signSessionToken(domain, API_SECRET, API_KEY)}` },
  };
}

async function seed(
  forStoreId: string,
  id: number,
  fields: Partial<typeof schema.shopifyProductGarments.$inferInsert> = {},
) {
  await app.db.insert(schema.shopifyProductGarments).values({
    storeId: forStoreId,
    shopifyProductId: id,
    r2Key: `shopify-garments/${forStoreId}/${id}/garment.jpg`,
    title: `Product ${id}`,
    status: 'active',
    ...fields,
  });
}

async function list(query: string, headers = auth): Promise<number[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/shopify/products?${query}`,
    headers,
  });
  expect(res.statusCode).toBe(200);
  return res
    .json()
    .items.map((i: { shopifyProductId: number }) => i.shopifyProductId)
    .sort((a: number, b: number) => a - b);
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const mine = await makeStore(1301, 'filter-a.myshopify.com');
  const other = await makeStore(1302, 'filter-b.myshopify.com');
  storeId = mine.store.id;
  auth = mine.headers;
  otherAuth = other.headers;

  await seed(storeId, 1, {
    productType: 'Saree',
    vendor: 'Acme',
    tags: ['silk', 'red'],
    collections: ['Festive'],
    category: 'Apparel > Saris',
  });
  await seed(storeId, 2, {
    productType: 'Kurta',
    vendor: 'Acme',
    tags: ['cotton'],
    collections: ['Summer'],
    category: 'Apparel > Tops',
  });
  await seed(storeId, 3, {
    productType: 'Saree',
    vendor: 'Globex',
    tags: ['cotton'],
    collections: ['Summer', 'Festive'],
    title: '100% cotton',
  });
  await seed(storeId, 4, { status: 'processing', title: 'plain' });
  await seed(storeId, 5, { status: 'deleted', productType: 'Saree' });
  await seed(other.store.id, 6, { productType: 'Saree' });
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/products filters', () => {
  it('hides deleted products by default and other stores always', async () => {
    expect(await list('')).toEqual([1, 2, 3, 4]);
    expect(await list('', otherAuth)).toEqual([6]);
  });

  it('filters by a single product type, and ORs several', async () => {
    expect(await list('productType=Saree')).toEqual([1, 3]);
    expect(await list('productType=Saree&productType=Kurta')).toEqual([1, 2, 3]);
  });

  it('filters by vendor', async () => {
    expect(await list('vendor=Globex')).toEqual([3]);
  });

  it('filters by tag using array overlap', async () => {
    expect(await list('tag=silk')).toEqual([1]);
    expect(await list('tag=silk&tag=cotton')).toEqual([1, 2, 3]);
  });

  it('filters by collection using array overlap', async () => {
    expect(await list('collection=Festive')).toEqual([1, 3]);
    expect(await list('collection=Summer')).toEqual([2, 3]);
  });

  it('filters by category', async () => {
    expect(await list('category=' + encodeURIComponent('Apparel > Saris'))).toEqual([1]);
  });

  it('ANDs different filters together', async () => {
    expect(await list('productType=Saree&vendor=Acme')).toEqual([1]);
    expect(await list('productType=Saree&tag=cotton&collection=Festive')).toEqual([3]);
  });

  it('filters by status', async () => {
    expect(await list('status=processing')).toEqual([4]);
    expect(await list('status=deleted')).toEqual([5]);
  });

  it('treats % and _ in the search text literally, not as wildcards', async () => {
    expect(await list(`q=${encodeURIComponent('100%')}`)).toEqual([3]);
    // A bare "%" would match every titled row if it were a wildcard.
    expect(await list(`q=${encodeURIComponent('%')}`)).toEqual([3]);
    expect(await list(`q=${encodeURIComponent('_')}`)).toEqual([]);
  });

  it('returns the new fields on each item', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products?productType=Kurta',
      headers: auth,
    });
    expect(res.json().items[0]).toMatchObject({
      shopifyProductId: 2,
      productType: 'Kurta',
      vendor: 'Acme',
      tags: ['cotton'],
      collections: ['Summer'],
      category: 'Apparel > Tops',
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-filter.test.ts`
Expected: FAIL — the filters are ignored (unknown params) so most list assertions return the wrong rows.

- [ ] **Step 3: Write the shared filter module**

Create `apps/api/src/modules/shopify/products.filter.ts`:

```ts
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
```

- [ ] **Step 4: Use it in the list route**

In `apps/api/src/modules/shopify/products.routes.ts`:

1. Imports: change the drizzle import to `import { and, count, eq } from 'drizzle-orm';` (remove `ilike` and `ne`, no longer used) and add `import { buildProductFilter, ProductListQuerySchema } from './products.filter.js';`.
2. Delete the `queryBoolean` const and the `ProductsQuery` const at the top of the file.
3. Replace the `GET /v1/shopify/products` handler with:

```ts
  app.get(
    '/v1/shopify/products',
    { preHandler: app.requireShopifySession, schema: { querystring: ProductListQuerySchema } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { page, pageSize, ...filter } = req.query as z.infer<typeof ProductListQuerySchema>;

      const where = buildProductFilter(store.id, filter);

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(schema.shopifyProductGarments)
        .where(where);

      const rows = await app.db
        .select({
          shopifyProductId: schema.shopifyProductGarments.shopifyProductId,
          title: schema.shopifyProductGarments.title,
          r2Key: schema.shopifyProductGarments.r2Key,
          status: schema.shopifyProductGarments.status,
          enabled: schema.shopifyProductGarments.enabled,
          excluded: schema.shopifyProductGarments.excluded,
          funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
          productType: schema.shopifyProductGarments.productType,
          tags: schema.shopifyProductGarments.tags,
          vendor: schema.shopifyProductGarments.vendor,
          collections: schema.shopifyProductGarments.collections,
          category: schema.shopifyProductGarments.category,
        })
        .from(schema.shopifyProductGarments)
        .where(where)
        .orderBy(schema.shopifyProductGarments.shopifyProductId)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      // Loaded ONCE for the page, then applied per row. Calling resolveBasket
      // per product would be a query per product on a catalog-sized page.
      const ruleSet = await loadRuleSet(app, store.id);

      const items = await Promise.all(
        rows.map(async (r) => {
          const basket = resolveBasketFrom(ruleSet, r as BasketMatchTarget);
          return {
            shopifyProductId: r.shopifyProductId,
            title: r.title,
            thumbnailUrl: (await app.storage.presignGet(r.r2Key, 3600)).url,
            status: r.status,
            enabled: r.enabled,
            excluded: r.excluded,
            productType: r.productType,
            vendor: r.vendor,
            tags: r.tags,
            collections: r.collections,
            category: r.category,
            basket: basket && { id: basket.basketId, label: basket.label, source: basket.source },
            // The raw pin on this row, independent of whether it's currently being
            // honored. Lets the client distinguish "no pin" from "pin exists but its
            // basket was deactivated, so we fell through to a rule" — the
            // resolved `basket.source` alone can't tell those apart.
            pinnedBasketId: r.funnelTemplateId,
          };
        }),
      );

      return { page, pageSize, total, items };
    },
  );
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-filter.test.ts test/integration/shopify-product-basket.test.ts`
Expected: PASS. (The second file is the existing list/pin test — it must still pass.)
Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: no errors.

- [ ] **Step 6: Commit (only if the user asked for commits)**

```bash
git add apps/api/src/modules/shopify/products.filter.ts apps/api/src/modules/shopify/products.routes.ts apps/api/test/shopify-products-filter.test.ts
git commit -m "feat(shopify): filter the product list by type, vendor, tag, collection and category"
```

---

### Task 3: Facets endpoint

**Files:**
- Create: `apps/api/src/modules/shopify/products.facets.ts`
- Modify: `apps/api/src/modules/shopify/products.routes.ts` (register the route)
- Test: `apps/api/test/shopify-products-filter.test.ts` (append)

**Interfaces:**
- Produces: `loadProductFacets(app, storeId, cap = 200): Promise<ProductFacets>` and `GET /v1/shopify/products/facets` returning
  ```ts
  type FacetList = { values: string[]; truncated: boolean };
  type ProductFacets = { productTypes: FacetList; vendors: FacetList; tags: FacetList; collections: FacetList; categories: FacetList };
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/shopify-products-filter.test.ts` (add `import { loadProductFacets } from '../src/modules/shopify/products.facets.js';` to the imports):

```ts
describe('GET /v1/shopify/products/facets', () => {
  it('returns sorted distinct values, scoped to the store and without deleted rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products/facets',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Product 5 is deleted (type Saree) and product 6 belongs to another store.
    expect(body.productTypes).toEqual({ values: ['Kurta', 'Saree'], truncated: false });
    expect(body.vendors).toEqual({ values: ['Acme', 'Globex'], truncated: false });
    expect(body.tags).toEqual({ values: ['cotton', 'red', 'silk'], truncated: false });
    expect(body.collections).toEqual({ values: ['Festive', 'Summer'], truncated: false });
    expect(body.categories).toEqual({
      values: ['Apparel > Saris', 'Apparel > Tops'],
      truncated: false,
    });
  });

  it('flags a list that was cut off at the cap', async () => {
    const facets = await loadProductFacets(app, storeId, 1);
    expect(facets.tags).toEqual({ values: ['cotton'], truncated: true });
    expect(facets.productTypes).toEqual({ values: ['Kurta'], truncated: true });
  });

  it('is empty for a store with no products', async () => {
    const empty = await makeStore(1303, 'filter-empty.myshopify.com');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products/facets',
      headers: empty.headers,
    });
    expect(res.json().categories).toEqual({ values: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-filter.test.ts`
Expected: FAIL — module `products.facets.js` not found / route 404.

- [ ] **Step 3: Implement**

Create `apps/api/src/modules/shopify/products.facets.ts`:

```ts
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
        .orderBy(column)
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
```

In `products.routes.ts`, add `import { loadProductFacets } from './products.facets.js';` and, inside `shopifyProductsRoutes` right after the list route:

```ts
  app.get('/v1/shopify/products/facets', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    return loadProductFacets(app, store.id);
  });
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-filter.test.ts`
Expected: PASS. If the `unnest ... orderBy(sql\`v\`)` query is rejected by Postgres, fall back to wrapping it: select from a subquery `sql\`(select distinct unnest(${column}) as v from ...)\`` — but try the direct form first; `SELECT DISTINCT unnest(x) AS v ... ORDER BY v` is valid Postgres.
Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add apps/api/src/modules/shopify/products.facets.ts apps/api/src/modules/shopify/products.routes.ts apps/api/test/shopify-products-filter.test.ts
git commit -m "feat(shopify): add product filter facets endpoint"
```

---

### Task 4: Bulk update endpoint

**Files:**
- Create: `apps/api/src/modules/shopify/products.bulk.ts`
- Modify: `apps/api/src/modules/shopify/products.routes.ts` (register the route)
- Test: `apps/api/test/shopify-products-bulk.test.ts`

**Interfaces:**
- Consumes: `ProductFilterSchema`, `buildProductFilter` from Task 2.
- Produces: `POST /v1/shopify/products/bulk`
  ```ts
  body: {
    target: { ids: number[] } | { filter: ProductFilter; excludeIds?: number[] };
    enabled?: true;
    funnelTemplateId?: string | null;
  }
  response: { updated: number; skipped: { notActive: number; excluded: number } }
  ```
  and `bulkUpdateProducts(app, store, body)` / `BulkBodySchema` exported from `products.bulk.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/shopify-products-bulk.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 14).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

let c: Containers;
let app: TestApp;
let storeId: string;
let otherStoreId: string;
let auth: { authorization: string };
let basketId: string;
let inactiveBasketId: string;

async function seedBasket(active: boolean): Promise<string> {
  const tag = `${Date.now()}-${Math.random()}`;
  const [workflow] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `bulk-wf-${tag}`,
      label: 'Bulk test workflow',
      jsonContent: {},
      poseNodeId: '2',
      upperNodeIds: ['4'],
      garmentPhasePromptNode: '6',
      workflowType: 'tryon',
      tryonPersonNodeId: '10',
      tryonGarmentNodeId: '11',
      tryonOutputNodeId: '12',
    })
    .returning();
  const [basket] = await app.db
    .insert(schema.shopifyFunnelTemplates)
    .values({
      slug: `bulk-basket-${tag}`,
      label: 'Bulk basket',
      workflowTemplateId: workflow.id,
      isActive: active,
    })
    .returning();
  return basket.id;
}

async function seed(
  forStoreId: string,
  id: number,
  fields: Partial<typeof schema.shopifyProductGarments.$inferInsert> = {},
) {
  await app.db.insert(schema.shopifyProductGarments).values({
    storeId: forStoreId,
    shopifyProductId: id,
    r2Key: `shopify-garments/${forStoreId}/${id}/garment.jpg`,
    title: `Product ${id}`,
    status: 'active',
    ...fields,
  });
}

async function row(forStoreId: string, id: number) {
  const [r] = await app.db
    .select()
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, forStoreId),
        eq(schema.shopifyProductGarments.shopifyProductId, id),
      ),
    );
  return r;
}

async function bulk(payload: unknown, headers = auth) {
  return app.inject({ method: 'POST', url: '/v1/shopify/products/bulk', headers, payload });
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const mine = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 1401,
      shopDomain: 'bulk-a.myshopify.com',
      myshopifyDomain: 'bulk-a.myshopify.com',
      name: 'A',
      email: 'a@bulk.com',
    },
    'tok',
    'read_products',
  );
  const other = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 1402,
      shopDomain: 'bulk-b.myshopify.com',
      myshopifyDomain: 'bulk-b.myshopify.com',
      name: 'B',
      email: 'b@bulk.com',
    },
    'tok',
    'read_products',
  );
  storeId = mine.id;
  otherStoreId = other.id;
  auth = {
    authorization: `Bearer ${signSessionToken('bulk-a.myshopify.com', API_SECRET, API_KEY)}`,
  };
  basketId = await seedBasket(true);
  inactiveBasketId = await seedBasket(false);
});

// Fresh rows per test so no test depends on another's writes.
beforeEach(async () => {
  await app.db
    .delete(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.storeId, storeId));
  await app.db
    .delete(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.storeId, otherStoreId));
  await seed(storeId, 1, { productType: 'Saree' });
  await seed(storeId, 2, { productType: 'Saree' });
  await seed(storeId, 3, { productType: 'Kurta' });
  await seed(storeId, 4, { status: 'processing' });
  await seed(storeId, 5, { excluded: true });
  await seed(otherStoreId, 1, { productType: 'Saree' });
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('POST /v1/shopify/products/bulk — enabling', () => {
  it('enables the listed active, non-excluded products and counts the skipped ones', async () => {
    const res = await bulk({ target: { ids: [1, 2, 4, 5] }, enabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, skipped: { notActive: 1, excluded: 1 } });
    expect((await row(storeId, 1)).enabled).toBe(true);
    expect((await row(storeId, 2)).enabled).toBe(true);
    expect((await row(storeId, 4)).enabled).toBe(false);
    expect((await row(storeId, 5)).enabled).toBe(false);
    expect((await row(storeId, 3)).enabled).toBe(false);
  });

  it('enables everything a filter matches', async () => {
    const res = await bulk({
      target: { filter: { productType: ['Saree'] } },
      enabled: true,
    });
    expect(res.json()).toEqual({ updated: 2, skipped: { notActive: 0, excluded: 0 } });
    expect((await row(storeId, 3)).enabled).toBe(false);
  });

  it('honours excludeIds with a filter target ("select all, except these")', async () => {
    const res = await bulk({
      target: { filter: { productType: ['Saree'] }, excludeIds: [2] },
      enabled: true,
    });
    expect(res.json().updated).toBe(1);
    expect((await row(storeId, 1)).enabled).toBe(true);
    expect((await row(storeId, 2)).enabled).toBe(false);
  });

  it("never touches another store's products, by id or by filter", async () => {
    const byId = await bulk({ target: { ids: [1] }, enabled: true });
    expect(byId.json().updated).toBe(1); // only this store's product 1
    expect((await row(otherStoreId, 1)).enabled).toBe(false);

    const byFilter = await bulk({ target: { filter: {} }, enabled: true });
    expect(byFilter.statusCode).toBe(200);
    expect((await row(otherStoreId, 1)).enabled).toBe(false);
  });

  it('is idempotent — repeating a call leaves the same end state', async () => {
    await bulk({ target: { ids: [1] }, enabled: true });
    const again = await bulk({ target: { ids: [1] }, enabled: true });
    expect(again.statusCode).toBe(200);
    expect((await row(storeId, 1)).enabled).toBe(true);
  });
});

describe('POST /v1/shopify/products/bulk — baskets', () => {
  it('pins the target products to a basket and records the source as manual', async () => {
    const res = await bulk({ target: { ids: [1, 2] }, funnelTemplateId: basketId });
    expect(res.json().updated).toBe(2);
    const r = await row(storeId, 1);
    expect(r.funnelTemplateId).toBe(basketId);
    expect(r.funnelAssignmentSource).toBe('manual');
    expect((await row(storeId, 3)).funnelTemplateId).toBeNull();
  });

  it('enables and pins in one call', async () => {
    await bulk({ target: { ids: [1] }, enabled: true, funnelTemplateId: basketId });
    const r = await row(storeId, 1);
    expect(r.enabled).toBe(true);
    expect(r.funnelTemplateId).toBe(basketId);
  });

  it('clears a pin and its source with null', async () => {
    await bulk({ target: { ids: [1] }, funnelTemplateId: basketId });
    await bulk({ target: { ids: [1] }, funnelTemplateId: null });
    const r = await row(storeId, 1);
    expect(r.funnelTemplateId).toBeNull();
    expect(r.funnelAssignmentSource).toBeNull();
  });

  it('rejects an inactive or unknown basket with 404 and changes nothing', async () => {
    const inactive = await bulk({
      target: { ids: [1] },
      enabled: true,
      funnelTemplateId: inactiveBasketId,
    });
    expect(inactive.statusCode).toBe(404);
    const unknown = await bulk({
      target: { ids: [1] },
      funnelTemplateId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(404);
    const r = await row(storeId, 1);
    expect(r.enabled).toBe(false);
    expect(r.funnelTemplateId).toBeNull();
  });
});

describe('POST /v1/shopify/products/bulk — validation', () => {
  it('requires enabled or funnelTemplateId', async () => {
    expect((await bulk({ target: { ids: [1] } })).statusCode).toBe(400);
  });

  it('rejects an empty ids list', async () => {
    expect((await bulk({ target: { ids: [] }, enabled: true })).statusCode).toBe(400);
  });

  it('rejects enabled: false — the wizard only ever enables', async () => {
    expect((await bulk({ target: { ids: [1] }, enabled: false })).statusCode).toBe(400);
  });

  it('requires a Shopify session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/products/bulk',
      payload: { target: { ids: [1] }, enabled: true },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-bulk.test.ts`
Expected: FAIL — route returns 404 (does not exist yet).

- [ ] **Step 3: Implement**

Create `apps/api/src/modules/shopify/products.bulk.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq, inArray, ne, notInArray, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildProductFilter, ProductFilterSchema } from './products.filter.js';

const ids = z.array(z.number().int().positive()).max(5000);

export const BulkBodySchema = z
  .object({
    target: z.union([
      z.object({ ids: ids.min(1) }).strict(),
      z
        .object({ filter: ProductFilterSchema, excludeIds: ids.optional() })
        .strict(),
    ]),
    // Only enabling: the wizard never needs to disable, and Manage already
    // handles that per product. `z.literal(true)` makes `false` a 400.
    enabled: z.literal(true).optional(),
    // null clears the pin. `.optional()` alone would make an absent key and an
    // explicit null indistinguishable, so `.nullable()` is load-bearing.
    funnelTemplateId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => b.enabled !== undefined || b.funnelTemplateId !== undefined, {
    message: 'at least one of enabled or funnelTemplateId is required',
  });
export type BulkBody = z.infer<typeof BulkBodySchema>;

export interface BulkResult {
  updated: number;
  skipped: { notActive: number; excluded: number };
}

/**
 * Enables and/or pins many products in one statement. The target is resolved
 * inside the UPDATE's WHERE clause (never as a big id list), always constrained
 * to the caller's store, so another store's ids or a broad filter can only ever
 * reach this store's rows.
 */
export async function bulkUpdateProducts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  body: BulkBody,
): Promise<BulkResult> {
  const t = schema.shopifyProductGarments;

  // Checked before anything is written so a stale basket can never leave the
  // products half-updated. Same 404 the single-product PATCH gives.
  if (body.funnelTemplateId) {
    const [basket] = await app.db
      .select({ id: schema.shopifyFunnelTemplates.id })
      .from(schema.shopifyFunnelTemplates)
      .where(
        and(
          eq(schema.shopifyFunnelTemplates.id, body.funnelTemplateId),
          eq(schema.shopifyFunnelTemplates.isActive, true),
        ),
      )
      .limit(1);
    if (!basket) throw new AppError('NOT_FOUND', 404, 'basket not found');
  }

  let matched: SQL;
  if ('ids' in body.target) {
    matched = and(
      eq(t.storeId, store.id),
      ne(t.status, 'deleted'),
      inArray(t.shopifyProductId, body.target.ids),
    ) as SQL;
  } else {
    const filter = buildProductFilter(store.id, body.target.filter);
    const excludeIds = body.target.excludeIds;
    matched = (
      excludeIds?.length ? and(filter, notInArray(t.shopifyProductId, excludeIds)) : filter
    ) as SQL;
  }

  return app.db.transaction(async (tx) => {
    // Why each matched product will or won't be enabled, counted up front so the
    // merchant can be told how many were skipped and why.
    const [counts] = await tx
      .select({
        notActive: sql<number>`count(*) filter (where ${t.status} <> 'active')`.mapWith(Number),
        excluded:
          sql<number>`count(*) filter (where ${t.status} = 'active' and ${t.excluded})`.mapWith(
            Number,
          ),
      })
      .from(t)
      .where(matched);

    // Enabling only reaches products that can actually be enabled — the same
    // rule the single-product PATCH enforces ("cannot enable a product that is
    // not active"), plus excluded products, which exclusion always overrides.
    const eligible = body.enabled
      ? (and(matched, eq(t.status, 'active'), eq(t.excluded, false)) as SQL)
      : matched;

    const patch: Partial<typeof t.$inferInsert> = {};
    if (body.enabled) patch.enabled = true;
    if (body.funnelTemplateId !== undefined) {
      patch.funnelTemplateId = body.funnelTemplateId;
      patch.funnelAssignmentSource = body.funnelTemplateId === null ? null : 'manual';
    }

    const rows = await tx.update(t).set(patch).where(eligible).returning({ id: t.id });
    return {
      updated: rows.length,
      skipped: body.enabled
        ? { notActive: counts.notActive, excluded: counts.excluded }
        : { notActive: 0, excluded: 0 },
    };
  });
}
```

In `products.routes.ts`, add `import { BulkBodySchema, type BulkBody, bulkUpdateProducts } from './products.bulk.js';` and register (next to the facets route):

```ts
  app.post(
    '/v1/shopify/products/bulk',
    { preHandler: app.requireShopifySession, schema: { body: BulkBodySchema } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      return bulkUpdateProducts(app, store, req.body as BulkBody);
    },
  );
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-products-bulk.test.ts`
Expected: PASS (all tests).
Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: no errors. If lint reorders imports, run `pnpm exec biome check --write apps/api/src/modules/shopify` and re-run.

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add apps/api/src/modules/shopify/products.bulk.ts apps/api/src/modules/shopify/products.routes.ts apps/api/test/shopify-products-bulk.test.ts
git commit -m "feat(shopify): add transactional bulk product enable and basket pin"
```

---

### Task 5: `unroutedEnabledCount` on `/me`

**Files:**
- Modify: `apps/api/src/modules/shopify/me.routes.ts` (around lines 90–100 and the `stats` object near line 184)
- Modify: `apps/api/test/shopify-me.test.ts`

**Interfaces:**
- Produces: `GET /v1/shopify/me` → `stats.unroutedEnabledCount: number | null` (`null` only when the routing scan is omitted above `COUNTS_PRODUCT_CAP`; `0` when nothing is enabled).

- [ ] **Step 1: Update and add tests**

In `apps/api/test/shopify-me.test.ts`:

1. In the first test's `toEqual({...})` for `body.stats`, add `unroutedEnabledCount: 0,` after `enabledProductCount: 1,` (the seeded enabled product 1 is pinned, so it is routed).
2. In the test `'excludes an effectively-enabled product that resolves to no basket'`, add after the existing `enabledProductCount` assertion:

```ts
      // …and it is reported as unrouted so the onboarding wizard knows a basket is still needed.
      expect(res.json().stats.unroutedEnabledCount).toBe(1);
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-me.test.ts`
Expected: FAIL — `unroutedEnabledCount` missing from the response.

- [ ] **Step 3: Implement**

In `me.routes.ts`, after the `enabledProductCount` computation add:

```ts
    // How many enabled products still resolve to no basket. Null when the routing
    // scan was skipped for a catalogue over COUNTS_PRODUCT_CAP (the client then
    // treats it as zero); zero when nothing is enabled, so there was nothing to scan.
    const unroutedEnabledCount = !unroutedCounts
      ? 0
      : unroutedCounts.countsOmitted
        ? null
        : (unroutedCounts.unroutedEnabled ?? 0);
```

and in the `stats: {...}` object add `unroutedEnabledCount,` right after `enabledProductCount,`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-me.test.ts`
Expected: PASS.
Run: `pnpm --filter @aivastra/api typecheck`

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add apps/api/src/modules/shopify/me.routes.ts apps/api/test/shopify-me.test.ts
git commit -m "feat(shopify): report unrouted enabled product count on /me"
```

---

### Task 6: Wizard derivation, types, and removing the Routing step

**Files:**
- Modify: `apps/shopify/src/types.ts`
- Modify: `apps/shopify/src/lib/onboarding.ts`
- Modify: `apps/shopify/src/lib/onboarding.test.ts`
- Modify: `apps/shopify/src/App.tsx`
- Modify: `apps/shopify/src/pages/OnboardingProductsPage.tsx` (compile fix only; rewritten in Task 9)
- Delete: `apps/shopify/src/pages/OnboardingRoutingPage.tsx`

**Interfaces:**
- Produces:
  ```ts
  // lib/onboarding.ts
  export type OnboardingStep = 'intro' | 'products' | 'theme';
  export function isSelectionDone(me: ShopifyMe): boolean;
  export function isBasketsDone(me: ShopifyMe): boolean;
  export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null;
  export function getOnboardingProgress(me: ShopifyMe): number;   // (1 + completed) / 4
  export function onboardingPath(step: OnboardingStep | null): string;
  // types.ts
  ShopifyStats.unroutedEnabledCount: number | null
  ShopifyProductListItem += productType, vendor, tags, collections, category
  ShopifyProductsResponse, FacetList, ShopifyProductFacets, ShopifyBulkResult
  ```

- [ ] **Step 1: Write the failing tests**

Replace the `getOnboardingStep`, `onboardingPath` and `getOnboardingProgress` describe blocks in `apps/shopify/src/lib/onboarding.test.ts` (keep the file's imports and `baseMe` helper, with the edits in Step 1a), with:

Step 1a — in `baseMe`'s `overrides` type add `unroutedEnabledCount?: number | null;`, and in the returned `stats` add
`unroutedEnabledCount: overrides.unroutedEnabledCount === undefined ? 0 : overrides.unroutedEnabledCount,`
right after `enabledProductCount`. Update the import line to
`import { getOnboardingProgress, getOnboardingStep, isBasketsDone, isSelectionDone, onboardingPath } from './onboarding';`.

Step 1b — the new blocks:

```ts
describe('getOnboardingStep', () => {
  it('returns intro for a fresh install with nothing done', () => {
    expect(getOnboardingStep(baseMe())).toBe('intro');
  });

  it('stays on products while products are synced but none is enabled', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 0 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('stays on products while an enabled product still has no basket', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 0, unroutedEnabledCount: 1 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('stays on products when some enabled products are routed and some are not', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: 1 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('moves to theme once every enabled product has a basket', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 3, unroutedEnabledCount: 0 });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('treats an omitted routing scan (null) as fully routed when something is routed', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 3, unroutedEnabledCount: null });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('still needs a basket in global mode when every product is unrouted', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      enabledProductCount: 0,
      unroutedEnabledCount: 5,
    });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('ignores the legacy onboardingRoutingConfirmed flag — routing is derived from live data now', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 0,
      unroutedEnabledCount: 1,
      onboardingRoutingConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('returns null once products, baskets and the theme block are done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 3,
      themeBlockConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBeNull();
  });

  it('skips the intro for a store that only ever confirmed the theme block (old checklist)', () => {
    expect(getOnboardingStep(baseMe({ themeBlockConfirmed: true }))).toBe('products');
  });
});

describe('isSelectionDone / isBasketsDone', () => {
  it('selection is done when something is enabled, routed or not', () => {
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, unroutedEnabledCount: 2 }))).toBe(true);
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, enabledProductCount: 1 }))).toBe(true);
    expect(isSelectionDone(baseMe({ syncedProductCount: 5 }))).toBe(false);
    expect(isSelectionDone(baseMe({ syncedProductCount: 0, enabledProductCount: 1 }))).toBe(false);
  });

  it('selection is done in global mode once anything is synced', () => {
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, activationMode: 'global' }))).toBe(true);
  });

  it('baskets are done only when selection is done and nothing is unrouted', () => {
    expect(isBasketsDone(baseMe({ syncedProductCount: 5, enabledProductCount: 2 }))).toBe(true);
    expect(
      isBasketsDone(baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: 1 })),
    ).toBe(false);
    expect(isBasketsDone(baseMe({ syncedProductCount: 5 }))).toBe(false);
  });
});

describe('onboardingPath', () => {
  it('maps intro to /onboarding', () => {
    expect(onboardingPath('intro')).toBe('/onboarding');
  });

  it('maps products and theme to their own sub-route', () => {
    expect(onboardingPath('products')).toBe('/onboarding/products');
    expect(onboardingPath('theme')).toBe('/onboarding/theme');
  });

  it('maps null (complete) to the app root', () => {
    expect(onboardingPath(null)).toBe('/');
  });
});

describe('getOnboardingProgress', () => {
  it('is 25% on a fresh install, where only the intro has been reached', () => {
    expect(getOnboardingProgress(baseMe())).toBe(0.25);
  });

  it('is 50% once products are picked but some still need a basket', () => {
    expect(
      getOnboardingProgress(baseMe({ syncedProductCount: 3, unroutedEnabledCount: 3 })),
    ).toBe(0.5);
  });

  it('is 75% once every enabled product has a basket', () => {
    expect(
      getOnboardingProgress(baseMe({ syncedProductCount: 3, enabledProductCount: 3 })),
    ).toBe(0.75);
  });

  it('is 100% once the theme block is confirmed too', () => {
    expect(
      getOnboardingProgress(
        baseMe({ syncedProductCount: 3, enabledProductCount: 3, themeBlockConfirmed: true }),
      ),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/shopify-admin exec vitest run src/lib/onboarding.test.ts`
Expected: FAIL — `isSelectionDone`/`isBasketsDone` are not exported, and the expectations differ.

- [ ] **Step 3: Rewrite `lib/onboarding.ts`**

Replace the whole file with:

```ts
import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'products' | 'theme';

/**
 * Something is enabled: the store has synced products and either global mode is
 * on or at least one product is individually enabled. `enabledProductCount`
 * only counts products that resolve to a basket, so the unrouted ones are added
 * back — a product the merchant just picked but has not given a basket yet
 * still counts as picked. `unroutedEnabledCount` is null when the API skipped
 * the routing scan for a very large catalogue; that is treated as zero.
 */
export function isSelectionDone(me: ShopifyMe): boolean {
  const { syncedProductCount, enabledProductCount, unroutedEnabledCount } = me.stats;
  const globalModeOn = me.store.settings.activation?.mode === 'global';
  return (
    syncedProductCount > 0 &&
    (globalModeOn || enabledProductCount + (unroutedEnabledCount ?? 0) > 0)
  );
}

/**
 * Every enabled product resolves to a basket. Derived from live data rather than
 * a stored flag — without a basket a product simply refuses try-on, so "the
 * merchant clicked Continue" is the wrong signal here.
 */
export function isBasketsDone(me: ShopifyMe): boolean {
  return (
    isSelectionDone(me) &&
    (me.stats.unroutedEnabledCount ?? 0) === 0 &&
    me.stats.enabledProductCount > 0
  );
}

/**
 * The wizard's current step, or null once every step is done. 'products' covers
 * both stages of page 2 (pick products, then pick baskets); which stage shows is
 * decided by isSelectionDone on that page. Intro has no flag of its own — it is
 * shown only on a genuinely fresh install (nothing synced, theme block not
 * confirmed); as soon as anything is started, a merchant resuming the wizard
 * jumps to the first incomplete step.
 */
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;
  const anythingStarted = me.stats.syncedProductCount > 0 || themeDone;
  if (!anythingStarted) return 'intro';

  if (!isBasketsDone(me)) return 'products';
  if (!themeDone) return 'theme';
  return null;
}

/**
 * How far through getting started the merchant is, as a 0–1 fraction for a
 * progress bar. The wizard is four stages — the intro plus three things to
 * complete (products picked, baskets assigned, theme block confirmed) — and the
 * intro counts as reached the moment it is shown, so a fresh install reads 25%
 * rather than an empty bar that looks broken.
 */
export function getOnboardingProgress(me: ShopifyMe): number {
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;
  const completed = [isSelectionDone(me), isBasketsDone(me), themeDone].filter(Boolean).length;
  return (1 + completed) / 4;
}

/** The route for a given step; null (onboarding complete) routes to the app root. */
export function onboardingPath(step: OnboardingStep | null): string {
  if (step === null) return '/';
  if (step === 'intro') return '/onboarding';
  return `/onboarding/${step}`;
}
```

- [ ] **Step 4: Update `types.ts`**

In `apps/shopify/src/types.ts`:

1. In `ShopifyStats`, after `enabledProductCount: number;` add:

```ts
  // Enabled products that still resolve to no basket. Null when the API skipped
  // the routing scan for a very large catalogue.
  unroutedEnabledCount: number | null;
```

2. In `ShopifyProductListItem`, after `pinnedBasketId: string | null;` add:

```ts
  productType: string | null;
  vendor: string | null;
  tags: string[] | null;
  collections: string[] | null;
  category: string | null;
```

3. After `ShopifyProductListItem`, add:

```ts
export interface ShopifyProductsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: ShopifyProductListItem[];
}

export interface FacetList {
  values: string[];
  // True when the API cut the list off at its cap — the UI then leans on search.
  truncated: boolean;
}

export interface ShopifyProductFacets {
  productTypes: FacetList;
  vendors: FacetList;
  tags: FacetList;
  collections: FacetList;
  categories: FacetList;
}

export interface ShopifyBulkResult {
  updated: number;
  skipped: { notActive: number; excluded: number };
}
```

- [ ] **Step 5: Remove the Routing page and fix compile errors**

1. Delete `apps/shopify/src/pages/OnboardingRoutingPage.tsx` (`git rm`).
2. In `App.tsx`: remove the `import OnboardingRoutingPage ...` line, and replace the `/onboarding/routing` `<Route>` element with:

```tsx
          {/* Old wizard step, removed when basket choice moved into page 2 —
              merchants may have it bookmarked. */}
          <Route path="/onboarding/routing" element={<Navigate to="/onboarding/products" replace />} />
```

Also update the comment near `refreshMe` that lists `confirm-routing` — change "sync, confirm-routing, confirm-theme-block" to "sync, product/basket changes, confirm-theme-block".
3. In `pages/OnboardingProductsPage.tsx`, change `navigate('/onboarding/routing')` to `navigate('/onboarding/theme')` and add `progress={getOnboardingProgress(me)}` to the `<OnboardingLayout ...>` props if it is not already there (it was added earlier in the footer work). This page is fully rewritten in Task 9; this edit only keeps the tree compiling.
4. Run `git grep -n "routing'" apps/shopify/src` and fix any other `'routing'` step references (`DashboardPage.tsx` only mentions `'products'` in a comment — leave it).

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `pnpm --filter @aivastra/shopify-admin exec vitest run`
Expected: PASS (all SPA test files).
Run: `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint`
Expected: no errors. If `ManagePage.tsx` or a test constructs a `ShopifyStats` or `ShopifyProductListItem` object literal, add the new fields there (`unroutedEnabledCount: 0`, and the five nullable product fields as `null`).

- [ ] **Step 7: Commit (only if the user asked for commits)**

```bash
git add apps/shopify/src
git commit -m "feat(shopify-admin): derive onboarding progress from products and baskets, drop the routing step"
```

---

### Task 7: Product filter and selection helpers

**Files:**
- Create: `apps/shopify/src/lib/products.ts`
- Create: `apps/shopify/src/lib/products.test.ts`
- Create: `apps/shopify/src/lib/productSelection.ts`
- Create: `apps/shopify/src/lib/productSelection.test.ts`

**Interfaces:**
- Produces (used by Tasks 8 and 9):
  ```ts
  // lib/products.ts
  export interface ProductFilterState {
    q: string; status: string | null;
    productType: string[]; vendor: string[]; tag: string[]; collection: string[]; category: string[];
    enabled?: boolean; excluded?: boolean;
  }
  export const DEFAULT_SELECTION_FILTER: ProductFilterState;   // status 'active', everything else empty
  export const CLEARED_FILTER: ProductFilterState;              // nothing applied at all
  export function filterToParams(f: ProductFilterState, paging?: { page: number; pageSize: number }): URLSearchParams;
  export function filterToBody(f: ProductFilterState): Record<string, unknown>;  // the bulk endpoint's `filter`
  // lib/productSelection.ts
  export type Selection = { kind: 'ids'; ids: ReadonlySet<number> } | { kind: 'all'; excluded: ReadonlySet<number> };
  export const EMPTY_SELECTION: Selection;
  export function isSelected(s: Selection, id: number): boolean;
  export function selectedCount(s: Selection, total: number): number;
  export function setMany(s: Selection, ids: number[], selecting: boolean): Selection;
  export function selectAllMatching(): Selection;
  export function toBulkTarget(s: Selection, filter: ProductFilterState): { ids: number[] } | { filter: Record<string, unknown>; excludeIds?: number[] };
  ```

- [ ] **Step 1: Write the failing tests**

`apps/shopify/src/lib/products.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLEARED_FILTER, DEFAULT_SELECTION_FILTER, filterToBody, filterToParams } from './products';

describe('filterToParams', () => {
  it('sends only what is set, repeating a key once per value', () => {
    const params = filterToParams(
      { ...CLEARED_FILTER, q: 'silk', productType: ['Saree', 'Kurta'], status: 'active' },
      { page: 2, pageSize: 20 },
    );
    expect(params.get('q')).toBe('silk');
    expect(params.getAll('productType')).toEqual(['Saree', 'Kurta']);
    expect(params.get('status')).toBe('active');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('20');
    expect(params.has('vendor')).toBe(false);
    expect(params.has('enabled')).toBe(false);
  });

  it('serialises the enabled/excluded booleans, including false', () => {
    const params = filterToParams({ ...CLEARED_FILTER, enabled: true, excluded: false });
    expect(params.get('enabled')).toBe('true');
    expect(params.get('excluded')).toBe('false');
  });

  it('omits a blank search', () => {
    expect(filterToParams({ ...CLEARED_FILTER, q: '   ' }).has('q')).toBe(false);
  });
});

describe('filterToBody', () => {
  it('produces the bulk endpoint filter shape and drops empty fields', () => {
    expect(
      filterToBody({ ...DEFAULT_SELECTION_FILTER, tag: ['silk'], q: ' saree ' }),
    ).toEqual({ status: 'active', tag: ['silk'], q: 'saree' });
  });

  it('is an empty object when nothing is applied', () => {
    expect(filterToBody(CLEARED_FILTER)).toEqual({});
  });
});
```

`apps/shopify/src/lib/productSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLEARED_FILTER } from './products';
import {
  EMPTY_SELECTION,
  isSelected,
  selectAllMatching,
  selectedCount,
  setMany,
  toBulkTarget,
} from './productSelection';

describe('explicit selection', () => {
  it('selects and deselects ids', () => {
    let s = setMany(EMPTY_SELECTION, [1, 2, 3], true);
    expect(selectedCount(s, 100)).toBe(3);
    s = setMany(s, [2], false);
    expect(isSelected(s, 2)).toBe(false);
    expect(isSelected(s, 1)).toBe(true);
    expect(selectedCount(s, 100)).toBe(2);
  });

  it('does not mutate the previous selection', () => {
    const before = setMany(EMPTY_SELECTION, [1], true);
    setMany(before, [2], true);
    expect(selectedCount(before, 100)).toBe(1);
  });

  it('becomes a plain { ids } bulk target', () => {
    const s = setMany(EMPTY_SELECTION, [3, 1], true);
    expect(toBulkTarget(s, CLEARED_FILTER)).toEqual({ ids: [3, 1] });
  });
});

describe('select all matching', () => {
  it('counts every match, minus the ones deselected afterwards', () => {
    let s = selectAllMatching();
    expect(selectedCount(s, 137)).toBe(137);
    expect(isSelected(s, 42)).toBe(true);
    s = setMany(s, [42, 43], false);
    expect(isSelected(s, 42)).toBe(false);
    expect(isSelected(s, 44)).toBe(true);
    expect(selectedCount(s, 137)).toBe(135);
  });

  it('re-selecting a deselected row removes it from the exclusions', () => {
    let s = setMany(selectAllMatching(), [7], false);
    s = setMany(s, [7], true);
    expect(isSelected(s, 7)).toBe(true);
    expect(toBulkTarget(s, CLEARED_FILTER)).toEqual({ filter: {} });
  });

  it('becomes a filter target carrying the exclusions', () => {
    const s = setMany(selectAllMatching(), [9], false);
    expect(toBulkTarget(s, { ...CLEARED_FILTER, status: 'active', vendor: ['Acme'] })).toEqual({
      filter: { status: 'active', vendor: ['Acme'] },
      excludeIds: [9],
    });
  });

  it('never reports a negative count', () => {
    const s = setMany(selectAllMatching(), [1, 2, 3], false);
    expect(selectedCount(s, 2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aivastra/shopify-admin exec vitest run src/lib/products.test.ts src/lib/productSelection.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/shopify/src/lib/products.ts`:

```ts
/** Everything the product filter UI can set. Mirrors the API's ProductFilter. */
export interface ProductFilterState {
  q: string;
  status: string | null;
  productType: string[];
  vendor: string[];
  tag: string[];
  collection: string[];
  category: string[];
  // Not user-facing controls — set by stage 2 to scope its list.
  enabled?: boolean;
  excluded?: boolean;
}

/** No filter at all. */
export const CLEARED_FILTER: ProductFilterState = {
  q: '',
  status: null,
  productType: [],
  vendor: [],
  tag: [],
  collection: [],
  category: [],
};

// Only active products can be enabled, so that is what the picker starts on —
// the merchant can remove the chip to see processing/failed ones.
export const DEFAULT_SELECTION_FILTER: ProductFilterState = {
  ...CLEARED_FILTER,
  status: 'active',
};

const LIST_KEYS = ['productType', 'vendor', 'tag', 'collection', 'category'] as const;

/** Query string for GET /v1/shopify/products. */
export function filterToParams(
  f: ProductFilterState,
  paging?: { page: number; pageSize: number },
): URLSearchParams {
  const params = new URLSearchParams();
  const q = f.q.trim();
  if (q) params.set('q', q);
  if (f.status) params.set('status', f.status);
  if (f.enabled !== undefined) params.set('enabled', String(f.enabled));
  if (f.excluded !== undefined) params.set('excluded', String(f.excluded));
  for (const key of LIST_KEYS) for (const value of f[key]) params.append(key, value);
  if (paging) {
    params.set('page', String(paging.page));
    params.set('pageSize', String(paging.pageSize));
  }
  return params;
}

/** The `filter` object for POST /v1/shopify/products/bulk — empty fields dropped. */
export function filterToBody(f: ProductFilterState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const q = f.q.trim();
  if (q) body.q = q;
  if (f.status) body.status = f.status;
  if (f.enabled !== undefined) body.enabled = f.enabled;
  if (f.excluded !== undefined) body.excluded = f.excluded;
  for (const key of LIST_KEYS) if (f[key].length > 0) body[key] = f[key];
  return body;
}
```

`apps/shopify/src/lib/productSelection.ts`:

```ts
import { filterToBody, type ProductFilterState } from './products';

/**
 * What the merchant has ticked in the product picker. Two shapes because "Select
 * all N matching" must survive paging: `all` means "every product the filter
 * matches, except these", so a deselect after select-all is remembered without
 * ever loading the other pages.
 */
export type Selection =
  | { kind: 'ids'; ids: ReadonlySet<number> }
  | { kind: 'all'; excluded: ReadonlySet<number> };

export const EMPTY_SELECTION: Selection = { kind: 'ids', ids: new Set() };

export function selectAllMatching(): Selection {
  return { kind: 'all', excluded: new Set() };
}

export function isSelected(s: Selection, id: number): boolean {
  return s.kind === 'ids' ? s.ids.has(id) : !s.excluded.has(id);
}

/** `total` is the number of products the current filter matches. */
export function selectedCount(s: Selection, total: number): number {
  return s.kind === 'ids' ? s.ids.size : Math.max(0, total - s.excluded.size);
}

/** Select or deselect several ids at once. Returns a new Selection. */
export function setMany(s: Selection, ids: number[], selecting: boolean): Selection {
  if (s.kind === 'ids') {
    const next = new Set(s.ids);
    for (const id of ids) {
      if (selecting) next.add(id);
      else next.delete(id);
    }
    return { kind: 'ids', ids: next };
  }
  const next = new Set(s.excluded);
  for (const id of ids) {
    // In "all" mode, selecting means "no longer excluded".
    if (selecting) next.delete(id);
    else next.add(id);
  }
  return { kind: 'all', excluded: next };
}

/** The `target` for POST /v1/shopify/products/bulk. */
export function toBulkTarget(
  s: Selection,
  filter: ProductFilterState,
): { ids: number[] } | { filter: Record<string, unknown>; excludeIds?: number[] } {
  if (s.kind === 'ids') return { ids: [...s.ids] };
  return s.excluded.size > 0
    ? { filter: filterToBody(filter), excludeIds: [...s.excluded] }
    : { filter: filterToBody(filter) };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @aivastra/shopify-admin exec vitest run src/lib/products.test.ts src/lib/productSelection.test.ts`
Expected: PASS.
Run: `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint`

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add apps/shopify/src/lib/products.ts apps/shopify/src/lib/products.test.ts apps/shopify/src/lib/productSelection.ts apps/shopify/src/lib/productSelection.test.ts
git commit -m "feat(shopify-admin): add product filter and selection helpers"
```

---

### Task 8: Stage 1 — product selection component

**Files:**
- Create: `apps/shopify/src/components/onboarding/ProductSelectionStage.tsx`

**Interfaces:**
- Consumes: `ProductFilterState`, `DEFAULT_SELECTION_FILTER`, `CLEARED_FILTER`, `filterToParams` (Task 7); `Selection` helpers (Task 7); `ShopifyProductsResponse`, `ShopifyProductFacets` (Task 6); `apiFetch`, `classifyError`, `ErrorBanner`.
- Produces:
  ```ts
  export interface StagePick { selection: Selection; filter: ProductFilterState; total: number }
  export function ProductSelectionStage(props: { onPickChange: (pick: StagePick) => void }): JSX.Element
  ```
  The parent (Task 9) keeps the latest `StagePick` and, on Continue, calls the bulk endpoint with `toBulkTarget(pick.selection, pick.filter)`.

This task has no automated test (no component-test tooling exists in `apps/shopify`, and its logic lives in the tested helpers). It is verified by typecheck, lint, build, and the manual browser check in Task 10.

- [ ] **Step 1: Write the component**

Create `apps/shopify/src/components/onboarding/ProductSelectionStage.tsx`:

```tsx
import {
  Badge,
  BlockStack,
  ChoiceList,
  IndexFilters,
  IndexFiltersMode,
  IndexTable,
  IndexTableSelectionType,
  InlineStack,
  Text,
  Thumbnail,
  useSetIndexFiltersMode,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import {
  CLEARED_FILTER,
  DEFAULT_SELECTION_FILTER,
  filterToParams,
  type ProductFilterState,
} from '../../lib/products';
import {
  EMPTY_SELECTION,
  isSelected,
  type Selection,
  selectAllMatching,
  selectedCount,
  setMany,
} from '../../lib/productSelection';
import type { FacetList, ShopifyProductFacets, ShopifyProductsResponse } from '../../types';
import { ErrorBanner } from '../ErrorBanner';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export interface StagePick {
  selection: Selection;
  filter: ProductFilterState;
  total: number;
}

type ListKey = 'productType' | 'vendor' | 'tag' | 'collection' | 'category';

const LIST_FILTERS: Array<{ key: ListKey; label: string; facet: keyof ShopifyProductFacets }> = [
  { key: 'productType', label: 'Product type', facet: 'productTypes' },
  { key: 'vendor', label: 'Vendor', facet: 'vendors' },
  { key: 'tag', label: 'Tag', facet: 'tags' },
  { key: 'collection', label: 'Collection', facet: 'collections' },
  { key: 'category', label: 'Category', facet: 'categories' },
];

const STATUS_CHOICES = [
  { label: 'Active', value: 'active' },
  { label: 'Processing', value: 'processing' },
  { label: 'Failed', value: 'failed' },
];

const STATUS_TONE: Record<string, 'success' | 'attention' | 'critical'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
};

export function ProductSelectionStage({ onPickChange }: { onPickChange: (pick: StagePick) => void }) {
  const [filter, setFilter] = useState<ProductFilterState>(DEFAULT_SELECTION_FILTER);
  const [queryInput, setQueryInput] = useState('');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [facets, setFacets] = useState<ShopifyProductFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const { mode, setMode } = useSetIndexFiltersMode(IndexFiltersMode.Default);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Report the latest pick upward so the page's footer Continue can act on it.
  useEffect(() => {
    onPickChange({ selection, filter, total });
  }, [selection, filter, total, onPickChange]);

  const updateFilter = useCallback((patch: Partial<ProductFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
    // "All matching" is bound to the filter it was made under; a different filter
    // would silently mean different products, so it is dropped. Ticked ids are
    // specific products and survive.
    setSelection((prev) => (prev.kind === 'all' ? EMPTY_SELECTION : prev));
  }, []);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (queryInput === filter.q) return;
    const t = setTimeout(() => updateFilter({ q: queryInput }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput, filter.q, updateFilter]);

  useEffect(() => {
    apiFetch<ShopifyProductFacets>('/v1/shopify/products/facets')
      .then(setFacets)
      // Filters are a convenience; the list still works without their options.
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<ShopifyProductsResponse>(
      `/v1/shopify/products?${filterToParams(filter, { page, pageSize: PAGE_SIZE })}`,
    )
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(classifyError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  const pageIds = items.map((i) => i.shopifyProductId);

  function handleSelectionChange(
    type: IndexTableSelectionType,
    selecting: boolean,
    arg?: string | [number, number],
  ) {
    switch (type) {
      case IndexTableSelectionType.All:
        setSelection(selecting ? selectAllMatching() : EMPTY_SELECTION);
        break;
      case IndexTableSelectionType.Page:
        setSelection((s) => setMany(s, pageIds, selecting));
        break;
      case IndexTableSelectionType.Single:
        setSelection((s) => setMany(s, [Number(arg)], selecting));
        break;
      default: {
        // Multi / Range: a [from, to] span of row positions on this page.
        const [from, to] = arg as [number, number];
        setSelection((s) => setMany(s, pageIds.slice(from, to + 1), selecting));
      }
    }
  }

  const facetOptions = (list: FacetList | undefined) =>
    (list?.values ?? []).map((v) => ({ label: v, value: v }));

  const filters = [
    ...LIST_FILTERS.filter(({ facet }) => (facets?.[facet].values.length ?? 0) > 0).map(
      ({ key, label, facet }) => ({
        key,
        label,
        filter: (
          <BlockStack gap="200">
            <ChoiceList
              title={label}
              titleHidden
              allowMultiple
              choices={facetOptions(facets?.[facet])}
              selected={filter[key]}
              onChange={(value) => updateFilter({ [key]: value })}
            />
            {facets?.[facet].truncated && (
              <Text as="p" tone="subdued" variant="bodySm">
                Showing the first values only — use search to narrow further.
              </Text>
            )}
          </BlockStack>
        ),
        shortcut: true,
      }),
    ),
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={STATUS_CHOICES}
          selected={filter.status ? [filter.status] : []}
          onChange={(value) => updateFilter({ status: value[0] ?? null })}
        />
      ),
      pinned: true,
    },
  ];

  const appliedFilters = [
    ...LIST_FILTERS.filter(({ key }) => filter[key].length > 0).map(({ key, label }) => ({
      key,
      label: `${label}: ${filter[key].join(', ')}`,
      onRemove: () => updateFilter({ [key]: [] }),
    })),
    ...(filter.status
      ? [
          {
            key: 'status',
            label: `Status: ${filter.status}`,
            onRemove: () => updateFilter({ status: null }),
          },
        ]
      : []),
  ];

  const allSelectedNoExclusions = selection.kind === 'all' && selection.excluded.size === 0;
  const pageSelectedCount = items.filter((i) => isSelected(selection, i.shopifyProductId)).length;
  const count = selectedCount(selection, total);

  return (
    <BlockStack gap="300">
      <ErrorBanner error={error} onRetry={() => updateFilter({})} />
      <IndexFilters
        tabs={[]}
        selected={0}
        onSelect={() => {}}
        canCreateNewView={false}
        mode={mode}
        setMode={setMode}
        queryValue={queryInput}
        queryPlaceholder="Search products by title"
        onQueryChange={setQueryInput}
        onQueryClear={() => {
          setQueryInput('');
          updateFilter({ q: '' });
        }}
        filters={filters}
        appliedFilters={appliedFilters}
        onClearAll={() => {
          setQueryInput('');
          updateFilter({ ...CLEARED_FILTER });
        }}
        loading={loading}
        disableStickyMode
      />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="p" tone="subdued">
          {count} of {total} product{total === 1 ? '' : 's'} selected
        </Text>
      </InlineStack>
      <IndexTable
        resourceName={{ singular: 'product', plural: 'products' }}
        itemCount={items.length}
        selectedItemsCount={allSelectedNoExclusions ? 'All' : pageSelectedCount}
        onSelectionChange={handleSelectionChange}
        hasMoreItems={total > items.length}
        paginatedSelectAllText={`All ${total} matching products are selected`}
        loading={loading}
        headings={[
          { title: 'Product' },
          { title: 'Type' },
          { title: 'Vendor' },
          { title: 'Status' },
        ]}
        pagination={{
          hasPrevious: page > 1,
          hasNext: page * PAGE_SIZE < total,
          onPrevious: () => setPage((p) => Math.max(1, p - 1)),
          onNext: () => setPage((p) => p + 1),
        }}
      >
        {items.map((item, index) => (
          <IndexTable.Row
            id={String(item.shopifyProductId)}
            key={item.shopifyProductId}
            position={index}
            selected={isSelected(selection, item.shopifyProductId)}
          >
            <IndexTable.Cell>
              <InlineStack gap="300" blockAlign="center">
                <Thumbnail source={item.thumbnailUrl} alt={item.title ?? 'Product'} size="small" />
                <Text as="span" fontWeight="semibold">
                  {item.title}
                </Text>
              </InlineStack>
            </IndexTable.Cell>
            <IndexTable.Cell>{item.productType ?? '—'}</IndexTable.Cell>
            <IndexTable.Cell>{item.vendor ?? '—'}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </BlockStack>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint`
Expected: no errors. Likely fix-ups if the compiler complains: Polaris's `IndexTableSelectionType` values are strings ('all'|'page'|'multi'|'single'|'range'), so if the `default:` branch's `arg` cast is rejected, narrow with `if (Array.isArray(arg))`; if `IndexFilters` rejects `onSelect={() => {}}` or empty `tabs`, pass `tabs={[{ id: 'all', content: 'All' }]}`; if `filters` items reject `shortcut`, drop it. Do not change behaviour to satisfy types — adjust the props only.

- [ ] **Step 3: Commit (only if the user asked for commits)**

```bash
git add apps/shopify/src/components/onboarding/ProductSelectionStage.tsx
git commit -m "feat(shopify-admin): add the onboarding product selection stage"
```

---

### Task 9: Stage 2 — baskets — and the page that ties the stages together

**Files:**
- Create: `apps/shopify/src/components/onboarding/BasketAssignmentStage.tsx`
- Modify: `apps/shopify/src/pages/OnboardingProductsPage.tsx` (full rewrite)

**Interfaces:**
- Consumes: everything from Tasks 6–8; `OnboardingLayout`; `isSelectionDone`, `isBasketsDone`, `getOnboardingProgress`.
- Produces: `BasketAssignmentStage({ me, onRefresh })`.

- [ ] **Step 1: Write the basket stage**

Create `apps/shopify/src/components/onboarding/BasketAssignmentStage.tsx`:

```tsx
import {
  BlockStack,
  Button,
  IndexTable,
  InlineStack,
  Select,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import { CLEARED_FILTER, filterToBody, filterToParams } from '../../lib/products';
import type { ShopifyMe, ShopifyProductsResponse } from '../../types';
import { ErrorBanner } from '../ErrorBanner';

const PAGE_SIZE = 20;

interface Basket {
  id: string;
  label: string;
}

/**
 * Stage 2: the products the merchant just enabled, each with a basket. "Apply to
 * all" pins one basket to every listed product; each row's own dropdown changes
 * just that product and saves immediately.
 */
export function BasketAssignmentStage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [chosen, setChosen] = useState('');
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [applying, setApplying] = useState(false);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  // In global mode every non-excluded product is enabled without its own
  // `enabled` flag (a legacy store mid-wizard), so filtering on it would show an
  // empty list. Otherwise stage 1 set `enabled` on exactly the products to list.
  const globalMode = me.store.settings.activation?.mode === 'global';
  const listFilter = {
    ...CLEARED_FILTER,
    status: 'active',
    excluded: false,
    ...(globalMode ? {} : { enabled: true }),
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ShopifyProductsResponse>(
        `/v1/shopify/products?${filterToParams(listFilter, { page, pageSize: PAGE_SIZE })}`,
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
    // listFilter is derived from `globalMode` only.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [page, globalMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch<{ items: Basket[] }>('/v1/shopify/baskets')
      .then((res) => setBaskets(res.items))
      .catch((err) => setError(classifyError(err)));
  }, []);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const unrouted = me.stats.unroutedEnabledCount ?? 0;
  const basketOptions = [
    { label: 'Choose a basket', value: '', disabled: true },
    ...baskets.map((b) => ({ label: b.label, value: b.id })),
  ];

  async function applyToAll() {
    if (!chosen) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/bulk', {
        method: 'POST',
        body: JSON.stringify({
          target: { filter: filterToBody(listFilter) },
          funnelTemplateId: chosen,
        }),
      });
      await Promise.all([load(), onRefresh()]);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setApplying(false);
    }
  }

  async function changeRow(shopifyProductId: number, basketId: string) {
    setBusyRow(shopifyProductId);
    setError(null);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ funnelTemplateId: basketId }),
      });
      await Promise.all([load(), onRefresh()]);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <BlockStack gap="300">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <BlockStack gap="200">
        <Text as="p">
          A basket decides which try-on experience a product uses. Pick one for everything, then
          change individual products below if they need a different one.
          {unrouted > 0 &&
            ` ${unrouted} product${unrouted === 1 ? ' still needs' : 's still need'} a basket.`}
        </Text>
        <InlineStack gap="300" blockAlign="end">
          <div style={{ minWidth: 220 }}>
            <Select
              label="Basket for all products"
              options={basketOptions}
              value={chosen}
              onChange={setChosen}
              disabled={applying || baskets.length === 0}
            />
          </div>
          <Button onClick={applyToAll} loading={applying} disabled={!chosen || total === 0}>
            {`Apply to all ${total} products`}
          </Button>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          This replaces any basket these products already have.
        </Text>
      </BlockStack>
        <IndexTable
          selectable={false}
          loading={loading}
          itemCount={items.length}
          resourceName={{ singular: 'product', plural: 'products' }}
          headings={[{ title: 'Product' }, { title: 'Basket' }]}
          pagination={{
            hasPrevious: page > 1,
            hasNext: page * PAGE_SIZE < total,
            onPrevious: () => setPage((p) => Math.max(1, p - 1)),
            onNext: () => setPage((p) => p + 1),
          }}
        >
          {items.map((item, index) => (
            <IndexTable.Row
              id={String(item.shopifyProductId)}
              key={item.shopifyProductId}
              position={index}
            >
              <IndexTable.Cell>
                <InlineStack gap="300" blockAlign="center">
                  <Thumbnail
                    source={item.thumbnailUrl}
                    alt={item.title ?? 'Product'}
                    size="small"
                  />
                  <Text as="span" fontWeight="semibold">
                    {item.title}
                  </Text>
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Select
                  label="Basket"
                  labelHidden
                  options={basketOptions}
                  value={item.basket?.id ?? ''}
                  disabled={busyRow === item.shopifyProductId || applying || baskets.length === 0}
                  onChange={(value) => changeRow(item.shopifyProductId, value)}
                />
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
    </BlockStack>
  );
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/shopify/src/pages/OnboardingProductsPage.tsx` with:

```tsx
import { Banner, BlockStack, Button, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { BasketAssignmentStage } from '../components/onboarding/BasketAssignmentStage';
import {
  ProductSelectionStage,
  type StagePick,
} from '../components/onboarding/ProductSelectionStage';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  getOnboardingProgress,
  getOnboardingStep,
  isBasketsDone,
  isSelectionDone,
  onboardingPath,
} from '../lib/onboarding';
import { DEFAULT_SELECTION_FILTER } from '../lib/products';
import { EMPTY_SELECTION, selectedCount, toBulkTarget } from '../lib/productSelection';
import type { ShopifyBulkResult, ShopifyMe } from '../types';

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pick, setPick] = useState<StagePick>({
    selection: EMPTY_SELECTION,
    filter: DEFAULT_SELECTION_FILTER,
    total: 0,
  });

  // Arriving here from the intro page's own Continue button is legitimate even
  // though getOnboardingStep still reports 'intro' at that instant — nothing has
  // synced yet, so the derived step can't have advanced. Only reject a genuinely
  // wrong step (e.g. a merchant typing /onboarding/theme directly).
  const currentStep = getOnboardingStep(me);

  const syncStarted = useRef(false);
  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  // Nothing synced yet: import the catalogue on arrival. The ref makes it run
  // once — an empty store (0 products after syncing) must not loop forever.
  useEffect(() => {
    if (me.stats.syncedProductCount === 0 && !syncStarted.current) {
      syncStarted.current = true;
      void runSync();
    }
  }, [me.stats.syncedProductCount, runSync]);

  if (currentStep !== 'products' && currentStep !== 'intro') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  // The stage follows the data, so a reload lands on the right one. There is no
  // Back between stages: the selection is committed when stage 1 is left, and
  // changing it afterwards happens in Manage.
  const selectionDone = isSelectionDone(me);
  const basketsDone = isBasketsDone(me);
  const picked = selectedCount(pick.selection, pick.total);

  async function commitSelection() {
    if (picked === 0 || committing) return;
    setCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<ShopifyBulkResult>('/v1/shopify/products/bulk', {
        method: 'POST',
        body: JSON.stringify({ target: toBulkTarget(pick.selection, pick.filter), enabled: true }),
      });
      const skipped = res.skipped.notActive + res.skipped.excluded;
      if (res.updated === 0) {
        setNotice(
          'None of the selected products could be enabled — they are still processing, failed to sync, or excluded.',
        );
      } else if (skipped > 0) {
        setNotice(
          `${skipped} selected product${skipped === 1 ? ' was' : 's were'} skipped: ${res.skipped.notActive} still processing or failed, ${res.skipped.excluded} excluded.`,
        );
      }
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setCommitting(false);
    }
  }

  const noProducts = !syncing && syncStarted.current && me.stats.syncedProductCount === 0;

  return (
    <OnboardingLayout
      step={selectionDone ? 2 : 1}
      totalSteps={3}
      progress={getOnboardingProgress(me)}
      title={selectionDone ? 'Choose a basket for your products' : 'Choose your products'}
      continueDisabled={selectionDone ? !basketsDone : picked === 0}
      continueLoading={committing}
      onContinue={selectionDone ? () => navigate('/onboarding/theme') : commitSelection}
    >
      <BlockStack gap="300">
        {/* Retry only makes sense for a failed import; a failed bulk save is retried by pressing Continue again. */}
        <ErrorBanner
          error={error}
          onRetry={me.stats.syncedProductCount === 0 && !syncing ? runSync : undefined}
          onDismiss={() => setError(null)}
        />
        {notice && (
          <Banner tone="warning" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        )}
        {syncing && (
          <BlockStack gap="200" inlineAlign="center">
            <Spinner accessibilityLabel="Importing your products" />
            <Text as="p" tone="subdued">
              Importing your products from Shopify…
            </Text>
          </BlockStack>
        )}
        {noProducts && (
          <BlockStack gap="200">
            <Text as="p">
              We couldn't find any products in your store. Add products in Shopify, then try again.
            </Text>
            <div>
              <Button onClick={runSync}>Import again</Button>
            </div>
          </BlockStack>
        )}
        {!syncing && !noProducts && me.stats.syncedProductCount > 0 && (
          <>
            {selectionDone ? (
              <BasketAssignmentStage me={me} onRefresh={onRefresh} />
            ) : (
              <ProductSelectionStage onPickChange={setPick} />
            )}
          </>
        )}
      </BlockStack>
    </OnboardingLayout>
  );
}
```

- [ ] **Step 3: Typecheck, lint, test, build**

Run: `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint`
Expected: no errors. If `biome flags the `useExhaustiveDependencies` ignore in `BasketAssignmentStage`, restructure instead: compute `listFilter` with `useMemo(() => ..., [globalMode])` and list it in `load`'s dependencies, then delete the ignore comment.
Run: `pnpm --filter @aivastra/shopify-admin exec vitest run`
Expected: all SPA tests PASS.
Run: `pnpm --filter @aivastra/shopify-admin build`
Expected: builds.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add apps/shopify/src
git commit -m "feat(shopify-admin): two-stage onboarding page — pick products, then baskets"
```

---

### Task 10: Full verification, docs, and browser check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-shopify-onboarding-product-basket-design.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: Run the whole affected surface**

```bash
pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint
pnpm --filter @aivastra/api exec vitest run test/shopify-sync.test.ts test/shopify-me.test.ts test/shopify-products-filter.test.ts test/shopify-products-bulk.test.ts test/integration/shopify-product-basket.test.ts
pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin exec vitest run
pnpm --filter @aivastra/shopify-admin build
```
Expected: every command exits 0 with no failures. Also run the full API unit suite once (`pnpm --filter @aivastra/api test`) to catch anything else that constructs product rows or `/me` stats; report any pre-existing failures separately (the vitest config notes a known-failing `jobs-create.test.ts`).

- [ ] **Step 2: Reflect the two planning refinements into the spec**

In the spec (`docs/superpowers/specs/2026-09-25-shopify-onboarding-product-basket-design.md`):
- In "Filter facets", change the JSON example and the sentence after it to `{ "productTypes": { "values": [], "truncated": false }, ... }` per list (same five keys), and say each list carries its own `truncated` flag.
- In the page-2 "Which stage shows" paragraph, replace "The stage lives in the URL (`?stage=baskets`) so a reload keeps it. With no param it derives from data" with "The stage is derived entirely from `/me` data (`selectionDone` → baskets stage), so a reload lands on the right stage with no URL state."

- [ ] **Step 3: Add the progress-log entry**

Insert a new dated section at the top of the entries in `docs/progress.md` (newest first, directly above `## 2026-09-21 — /results grid thumbnails ...`), following the existing Done / Not done format:

```markdown
## 2026-09-25 — Shopify onboarding: pick products, then baskets

- **Change:** onboarding page 2 is now two stages (spec:
  `docs/superpowers/specs/2026-09-25-shopify-onboarding-product-basket-design.md`).
  1. New product filters on `GET /v1/shopify/products` (type, vendor, tag, collection,
     category, status, title search with literal `%`/`_`), a facets endpoint, and a
     transactional `POST /v1/shopify/products/bulk` (enable and/or pin, by ids or by
     filter + `excludeIds`, store-scoped, 404 on an inactive basket).
  2. New nullable `shopify_product_garments.category` (Shopify taxonomy `fullName`),
     filled by the product sync. **Migration `0205` is generated locally and ships via
     CI → `db:migrate:prod`; existing stores get categories only after their next sync.**
  3. `/me` returns `stats.unroutedEnabledCount`. The SPA derives wizard progress from it
     (no new flag): Intro → Page 2 (pick, then baskets) → Theme, progress 25/50/75/100%.
  4. The Routing onboarding page is removed; `/onboarding/routing` redirects to page 2.
     `confirm-routing` and `onboardingRoutingConfirmed` are left in place, unused.
- **Behaviour change:** the wizard's sync no longer switches the store to global mode.
- **Not done:** assigning baskets by filter group, a Back control between the stages,
  removing the unused `confirm-routing` route/flag, backfilling categories for existing
  stores without waiting for a re-sync.
- **Open question:** none blocking. The page-2 layout has only been checked by typecheck
  and build; it needs a browser pass inside the Shopify admin iframe (dev store).
```

- [ ] **Step 4: Manual browser pass (dev store)**

The embedded app only renders inside the Shopify admin iframe, so use the local dev store (`make shopify-deploy-staging` is for staging; locally use the tunnel/`shopify app dev` flow already set up). Check, at your usual window size:
1. A fresh store: page 2 shows "Importing your products…", then the picker.
2. Search, a type filter, a tag filter; chips appear and are removable; the default `Status: active` chip is present.
3. Tick two rows → footer Continue enables; tick the header checkbox → "Select all N" banner appears; select all, untick one on page 2, Continue → the notice/counts are right.
4. Stage 2 lists the enabled products; "Apply to all" fills every dropdown; changing one row saves; footer Continue stays disabled until nothing is unrouted; the progress bar reads 50% → 75%.
5. Reload on stage 2 → still stage 2. Type `/onboarding/routing` → lands on page 2.
6. The footer and progress bar stay pinned at the bottom while the table scrolls inside the panel.

Record anything that looks wrong; do not mark the work complete until this pass is done or the user has explicitly waived it.

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add docs/superpowers/specs/2026-09-25-shopify-onboarding-product-basket-design.md docs/progress.md
git commit -m "docs: record onboarding product/basket work"
```

---

## Self-Review

**Spec coverage**
- Flow and completion (spec §Flow) → Task 6 (`isSelectionDone`, `isBasketsDone`, `getOnboardingStep`, `getOnboardingProgress`, `onboardingPath`, routing redirect).
- List filters + richer rows + shared builder (§Product list) → Task 2. Collection-filter caveat is documentation only.
- Facets (§Filter facets) → Task 3.
- Bulk endpoint incl. transaction, skip counts, 404 basket, `excludeIds`, store scoping (§Bulk update) → Task 4.
- `category` column, migration, sync, no backfill (§Category column) → Task 1; the hide-when-empty behaviour is in Task 8 (`LIST_FILTERS` filters out facets with no values); sync-on-entry is Task 9.
- `/me` `unroutedEnabledCount` (§/me) → Task 5; mirrored in `types.ts` in Task 6.
- Wizard sync no longer switching global mode (§Wizard sync) → Task 9 (the rewritten page calls sync only; the old `activation/mode` call is gone).
- Page 2 UI: stage 1 filters/table/select-all/Continue (§Stage 1) → Tasks 7–9; stage 2 apply-to-all, per-row, Continue gating (§Stage 2) → Task 9; entry sync + retry + empty state → Task 9; removals/redirects → Task 6.
- Error handling and testing (§Error handling, §Testing) → tests in Tasks 1–7; manual pass in Task 10. Sync category test is Task 1.
- Risks: overwrite warning text is in Task 9's stage 2; large-catalogue `null` handling is tested in Task 6.

**Placeholder scan:** no TBD/TODO. Every code step has the code. Two steps intentionally give a fallback if the compiler rejects a Polaris prop shape (Task 8 Step 2, Task 9 Step 3) — these describe a concrete alternative, not a deferral.

**Type consistency:** `ProductFilter`/`ProductFilterSchema`/`buildProductFilter` (Task 2) are the names Task 4 imports. `ProductFilterState`, `DEFAULT_SELECTION_FILTER`, `CLEARED_FILTER`, `filterToParams`, `filterToBody` (Task 7) match their uses in Tasks 8–9. `Selection`, `EMPTY_SELECTION`, `selectAllMatching`, `setMany`, `isSelected`, `selectedCount`, `toBulkTarget` (Task 7) match Tasks 8–9. `StagePick` (Task 8) is consumed in Task 9. `ShopifyProductsResponse`, `ShopifyProductFacets`, `FacetList`, `ShopifyBulkResult` (Task 6) match Tasks 8–9. `isSelectionDone`/`isBasketsDone` (Task 6) match Task 9. `OnboardingLayout`'s `progress` prop (already added in the earlier footer work) matches the Task 9 usage. `BulkBody`/`BulkBodySchema`/`bulkUpdateProducts` (Task 4) match the route registration.

**Review Focus coverage:** (1) `%`/`_` search → Task 2 test. (2) select-all + deselect / filter change → Task 7 tests for exclusions and Task 8's `updateFilter` dropping the `all` selection; the bulk `excludeIds` is tested in Task 4. (3) other-store ids → Task 4 test. (4) empty store no loop → Task 9's `syncStarted` ref and empty state (manual pass item 1 covers the happy path; the empty-store branch is verified by reading the page logic and by the manual check on a store with no products). (5) legacy global mode and stale basket → Task 4 (404, nothing changed) and Task 9 (`globalMode` list filter).
