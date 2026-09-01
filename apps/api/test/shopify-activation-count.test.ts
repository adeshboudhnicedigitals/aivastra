import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeEffectiveEnabled,
  countEffectivelyEnabled,
} from '../src/modules/shopify/activation.js';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

/**
 * `countEffectivelyEnabled` expresses the activation rule in SQL for speed,
 * making it the one place that can silently drift from `computeEffectiveEnabled`
 * — the canonical rule every other caller goes through. This seeds one product
 * for every combination of the four per-product inputs and asserts, in both
 * modes, that the SQL count equals the number the canonical function says is
 * enabled. Change one without the other and this fails.
 */

const ENABLED_COLLECTION = 100;
const EXCLUDED_COLLECTION = 200;

interface Combo {
  individuallyEnabled: boolean;
  individuallyExcluded: boolean;
  inEnabledCollection: boolean;
  inExcludedCollection: boolean;
}

// All 16 combinations of the four booleans.
const COMBOS: Combo[] = Array.from({ length: 16 }, (_, i) => ({
  individuallyEnabled: !!(i & 1),
  individuallyExcluded: !!(i & 2),
  inEnabledCollection: !!(i & 4),
  inExcludedCollection: !!(i & 8),
}));

let c: Containers;
let app: TestApp;
let storeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
    SHOPIFY_API_SECRET: 'test-secret',
    SHOPIFY_API_KEY: 'test-key',
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 991,
      shopDomain: 'count.myshopify.com',
      myshopifyDomain: 'count.myshopify.com',
      name: 'Count',
      email: 'count@example.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;

  await app.db.insert(schema.shopifyEnabledCollections).values({
    storeId,
    shopifyCollectionId: ENABLED_COLLECTION,
  });
  await app.db.insert(schema.shopifyExcludedCollections).values({
    storeId,
    shopifyCollectionId: EXCLUDED_COLLECTION,
  });

  await app.db.insert(schema.shopifyProductGarments).values(
    COMBOS.map((combo, i) => ({
      storeId,
      shopifyProductId: 1000 + i,
      shopifyVariantId: null,
      r2Key: `k${i}`,
      title: `Product ${i}`,
      status: 'active' as const,
      enabled: combo.individuallyEnabled,
      excluded: combo.individuallyExcluded,
    })),
  );

  const memberships = COMBOS.flatMap((combo, i) => {
    const rows: { storeId: string; shopifyCollectionId: number; shopifyProductId: number }[] = [];
    if (combo.inEnabledCollection) {
      rows.push({ storeId, shopifyCollectionId: ENABLED_COLLECTION, shopifyProductId: 1000 + i });
    }
    if (combo.inExcludedCollection) {
      rows.push({ storeId, shopifyCollectionId: EXCLUDED_COLLECTION, shopifyProductId: 1000 + i });
    }
    return rows;
  });
  await app.db.insert(schema.shopifyCollectionProducts).values(memberships);
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function setModeAndCount(mode: 'global' | 'selective'): Promise<number> {
  const [existing] = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, storeId));

  await app.db
    .update(schema.shopifyStores)
    .set({ settings: { ...existing.settings, activation: { mode } } })
    .where(eq(schema.shopifyStores.id, storeId));

  const [store] = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, storeId));

  return countEffectivelyEnabled(app, store);
}

describe('countEffectivelyEnabled', () => {
  for (const mode of ['selective', 'global'] as const) {
    it(`matches computeEffectiveEnabled across all 16 input combinations in ${mode} mode`, async () => {
      const expected = COMBOS.filter((combo) => computeEffectiveEnabled({ mode, ...combo })).length;

      await expect(setModeAndCount(mode)).resolves.toBe(expected);
    });
  }

  it('counts nothing for a store with no synced products', async () => {
    const other = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 992,
        shopDomain: 'empty.myshopify.com',
        myshopifyDomain: 'empty.myshopify.com',
        name: 'Empty',
        email: 'empty@example.com',
      },
      'tok',
      'read_products',
    );
    await expect(countEffectivelyEnabled(app, other)).resolves.toBe(0);
  });

  it('never counts another store rows', async () => {
    // Same product ids and collection ids as the seeded store, different store.
    const other = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 993,
        shopDomain: 'neighbour.myshopify.com',
        myshopifyDomain: 'neighbour.myshopify.com',
        name: 'Neighbour',
        email: 'n@example.com',
      },
      'tok',
      'read_products',
    );
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: other.id,
      shopifyProductId: 1000,
      shopifyVariantId: null,
      r2Key: 'n',
      title: 'Neighbour product',
      status: 'active',
      enabled: true,
    });
    // The neighbour has exactly one enabled product of its own, regardless of
    // the 16 seeded against the other store.
    await expect(countEffectivelyEnabled(app, other)).resolves.toBe(1);
  });
});
