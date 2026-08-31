import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestApiKey, createTestMerchant } from '../helpers/merchant.js';

/**
 * jobs.merchantId is never set by the dev-API job creator (createDevJobCore
 * only stamps userId + apiKeyId) — the owning merchant is reached through the
 * API key, same as GET /v1/dev/jobs/:id. `daysAgo` lets tests place a job
 * inside or outside the 14/30-day analytics windows.
 */
async function seedWordpressTryonJob(
  app: TestApp,
  opts: { apiKeyId: string; userId: string; daysAgo?: number },
) {
  const createdAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000);
  await app.db.insert(schema.jobs).values({
    userId: opts.userId,
    apiKeyId: opts.apiKeyId,
    status: 'COMPLETED',
    source: 'wordpress_tryon',
    createdAt,
  });
}

describe('POST /v1/dev/widget-event', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('records an event scoped to the calling merchant, using a widget-scoped key', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/widget-event',
      headers: { authorization: `Bearer ${key}` },
      payload: { type: 'add_to_cart', productId: 42, clientId: 'client-abc', device: 'mobile' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });

    const rows = await app.db
      .select()
      .from(schema.merchantWidgetEvents)
      .where(eq(schema.merchantWidgetEvents.merchantId, merchant.merchantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'add_to_cart',
      productId: 42,
      clientId: 'client-abc',
      device: 'mobile',
    });
  });

  it('rejects an unknown event type with 400', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/widget-event',
      headers: { authorization: `Bearer ${key}` },
      payload: { type: 'not_a_real_type' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a revoked key', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, {
      scope: 'widget',
      revoked: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/widget-event',
      headers: { authorization: `Bearer ${key}` },
      payload: { type: 'button_click' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/dev/analytics', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('rejects a widget-scoped key with 403', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/analytics',
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('counts real try-ons from jobs (via the api key), scoped to this merchant only, excluding jobs outside the window', async () => {
    const merchant = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'full' });
    const { id: apiKeyId } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });
    const { id: otherApiKeyId } = await createTestApiKey(app, other.merchantId, {
      scope: 'widget',
    });

    await seedWordpressTryonJob(app, { apiKeyId, userId: merchant.userId, daysAgo: 1 });
    await seedWordpressTryonJob(app, { apiKeyId, userId: merchant.userId, daysAgo: 5 });
    // Outside the 30-day cards window — must not be counted.
    await seedWordpressTryonJob(app, { apiKeyId, userId: merchant.userId, daysAgo: 40 });
    // A different merchant's job — must not leak into this merchant's count.
    await seedWordpressTryonJob(app, { apiKeyId: otherApiKeyId, userId: other.userId, daysAgo: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/analytics',
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cards: { tryOns: number; uniqueShoppers: number; addedToCart: number; addToCartRate: number };
      daily: { day: string; tryOns: number }[];
      products: unknown[];
    };
    expect(body.cards.tryOns).toBe(2);
    // 14-day daily window zero-fills every day, so the total across it must
    // equal the in-window try-ons above (the 5-day-old one is inside 14 days).
    expect(body.daily.reduce((sum, d) => sum + d.tryOns, 0)).toBe(2);
  });

  it('derives uniqueShoppers, addedToCart, and per-product breakdown from advisory widget events only', async () => {
    const merchant = await createTestMerchant(app);
    const { key: fullKey } = await createTestApiKey(app, merchant.merchantId, { scope: 'full' });
    const { key: widgetKey } = await createTestApiKey(app, merchant.merchantId, {
      scope: 'widget',
    });

    const events: { type: string; productId?: number; clientId?: string }[] = [
      { type: 'button_click', clientId: 'shopper-1' },
      { type: 'result_view', productId: 7, clientId: 'shopper-1' },
      { type: 'add_to_cart', productId: 7, clientId: 'shopper-1' },
      { type: 'result_view', productId: 7, clientId: 'shopper-2' },
      { type: 'result_view', productId: 9, clientId: 'shopper-2' },
    ];
    for (const event of events) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/dev/widget-event',
        headers: { authorization: `Bearer ${widgetKey}` },
        payload: event,
      });
      expect(res.statusCode).toBe(202);
    }

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/analytics',
      headers: { authorization: `Bearer ${fullKey}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cards: { uniqueShoppers: number; addedToCart: number };
      products: {
        productId: number;
        tryOns: number;
        uniqueShoppers: number;
        addedToCart: number;
      }[];
    };
    expect(body.cards.uniqueShoppers).toBe(2);
    expect(body.cards.addedToCart).toBe(1);

    const byProduct = new Map(body.products.map((p) => [p.productId, p]));
    expect(byProduct.get(7)).toMatchObject({ tryOns: 2, uniqueShoppers: 2, addedToCart: 1 });
    expect(byProduct.get(9)).toMatchObject({ tryOns: 1, uniqueShoppers: 1, addedToCart: 0 });
  });
});
