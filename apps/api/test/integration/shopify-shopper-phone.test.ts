import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveShopper } from '../../src/modules/shopify/shopper.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify shopper phone capture', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let storeId: string;
  const clientId = randomUUID();

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `phone-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning({ id: schema.shopifyStores.id });
    storeId = store.id;
  });

  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  it('stores, preserves, replaces, and ignores blank phone values', async () => {
    const first = await resolveShopper(app, storeId, { clientId, phone: ' 555 0100 123 ' });
    expect(first.phone).toBe('555 0100 123');
    expect(first.phoneCapturedAt).toBeInstanceOf(Date);

    const preserved = await resolveShopper(app, storeId, { clientId });
    expect(preserved.phone).toBe('555 0100 123');

    const replaced = await resolveShopper(app, storeId, { clientId, phone: '555 0100 999' });
    expect(replaced.phone).toBe('555 0100 999');

    const blank = await resolveShopper(app, storeId, { clientId, phone: '   ' });
    expect(blank.phone).toBe('555 0100 999');

    const [row] = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(eq(schema.shopifyShoppers.clientId, clientId));
    expect(row.phone).toBe('555 0100 999');
  });
});
