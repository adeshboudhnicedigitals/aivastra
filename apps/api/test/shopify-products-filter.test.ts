import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { loadProductFacets } from '../src/modules/shopify/products.facets.js';
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
  // Ghost rows: every facet value below appears on no other row, so the facets
  // test fails if deleted rows or another store's rows leak into the lists.
  await seed(storeId, 5, {
    status: 'deleted',
    productType: 'GhostDeletedType',
    vendor: 'GhostDeletedVendor',
    tags: ['ghost-deleted'],
    collections: ['GhostDeletedColl'],
    category: 'Ghost > Deleted',
  });
  await seed(other.store.id, 6, {
    productType: 'GhostOtherType',
    vendor: 'GhostOtherVendor',
    tags: ['ghost-other'],
    collections: ['GhostOtherColl'],
    category: 'Ghost > Other',
  });
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
    expect(await list(`category=${encodeURIComponent('Apparel > Saris')}`)).toEqual([1]);
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

describe('GET /v1/shopify/products/facets', () => {
  it('returns sorted distinct values, scoped to the store and without deleted rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products/facets',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Product 5 is deleted and product 6 belongs to another store; both carry
    // ghost values on every facet that must not appear in any list.
    expect(body.productTypes).toEqual({ values: ['Kurta', 'Saree'], truncated: false });
    expect(body.vendors).toEqual({ values: ['Acme', 'Globex'], truncated: false });
    expect(body.tags).toEqual({ values: ['cotton', 'red', 'silk'], truncated: false });
    expect(body.collections).toEqual({ values: ['Festive', 'Summer'], truncated: false });
    expect(body.categories).toEqual({
      values: ['Apparel > Saris', 'Apparel > Tops'],
      truncated: false,
    });
    const everyValue = JSON.stringify(body);
    expect(everyValue).not.toMatch(/ghost/i);
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
