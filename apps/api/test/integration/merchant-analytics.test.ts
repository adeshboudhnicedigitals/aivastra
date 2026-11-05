import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

async function createMerchant(app: TestApp, email: string) {
  const [merchantUser] = await app.db
    .insert(schema.users)
    .values({ email, passwordHash: 'unused' })
    .returning();
  const [merchant] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Merchant Co',
      contactName: 'Merchant Owner',
      phone: '9999999999',
      businessAddress: 'Test Street',
      isActive: true,
      userId: merchantUser.id,
    })
    .returning();
  return { merchant, merchantUser };
}

async function authHeader(userId: string) {
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
  return { authorization: `Bearer ${token}` };
}

async function seedGarmentType(app: TestApp, label: string) {
  const [g] = await app.db
    .insert(schema.garmentSubcategories)
    .values({ genderSlug: 'women', slug: label.toLowerCase(), label })
    .returning();
  return g;
}

async function seedItem(
  app: TestApp,
  merchantId: string,
  garmentTypeId: string,
  subName: string,
  label: string,
) {
  const [sub] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({
      merchantId,
      category: 'women',
      name: subName,
      garmentSubcategoryId: garmentTypeId,
    })
    .returning();
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: sub.id,
      label,
      actualPricePaise: 100,
      offerPricePaise: 100,
      r2Key: `k/${label}`,
      thumbnailKey: `t/${label}`,
    })
    .returning();
  return item;
}

async function seedTryon(
  app: TestApp,
  o: {
    merchantId: string;
    userId: string;
    itemId?: string;
    status?: string;
    source?: string;
    daysAgo: number;
    extraParams?: Record<string, unknown>;
  },
) {
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      merchantId: o.merchantId,
      userId: o.userId,
      customerPhotoKey: 'merchant-inputs/p.jpg',
      status: o.status ?? 'COMPLETED',
      source: o.source ?? JOB_SOURCE.MERCHANT_TRYON,
      createdAt: new Date(Date.now() - o.daysAgo * 86_400_000),
    })
    .returning();
  await app.db.insert(schema.jobInputs).values({
    jobId: job.id,
    params: { ...(o.itemId ? { merchantCatalogItemId: o.itemId } : {}), ...o.extraParams },
  });
  return job;
}

describe('merchant analytics', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('counts only completed try-ons and compares with the previous period', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-a@example.com');
    const g = await seedGarmentType(app, 'Saree-a');
    const item = await seedItem(app, merchant.id, g.id, 'Silk', 'Silk Border Saree');
    const base = { merchantId: merchant.id, userId: merchantUser.id };
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 1 });
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 2 });
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 3, status: 'FAILED' });
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 40 }); // previous 30d window
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics?range=30d',
      headers: await authHeader(merchantUser.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTryOns).toBe(2);
    expect(body.previousTryOns).toBe(1);
    expect(body.topProducts).toEqual([
      { rank: 1, itemId: item.id, name: 'Silk Border Saree', tryOns: 2 },
    ]);
    expect(body.topGarmentType).toEqual({ name: 'Saree-a', tryOns: 2 });
    expect(body.categories).toEqual([{ name: 'Silk', tryOns: 2, pct: 100 }]);
    expect(body.leastTriedProduct).toBeNull(); // only one product ranked
  });

  it('counts legacy jobs without an item id in totals but not rankings', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-b@example.com');
    await seedTryon(app, { merchantId: merchant.id, userId: merchantUser.id, daysAgo: 1 });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(merchantUser.id),
    });
    const body = res.json();
    expect(body.totalTryOns).toBe(1);
    expect(body.topProducts).toEqual([]);
    expect(body.mostTriedProduct).toBeNull();
    expect(body.breakdownSince).toBeNull();
  });

  it("never includes another merchant's jobs", async () => {
    const a = await createMerchant(app, 'an-c@example.com');
    const b = await createMerchant(app, 'an-d@example.com');
    const g = await seedGarmentType(app, 'Kurta-c');
    const bItem = await seedItem(app, b.merchant.id, g.id, 'Cotton', 'B Kurta');
    await seedTryon(app, {
      merchantId: b.merchant.id,
      userId: b.merchantUser.id,
      itemId: bItem.id,
      daysAgo: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(a.merchantUser.id),
    });
    const body = res.json();
    expect(body.totalTryOns).toBe(0);
    expect(body.topProducts).toEqual([]);
  });

  it('ranks most and least tried across several products and honours the range', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-e@example.com');
    const g = await seedGarmentType(app, 'Blazer-e');
    const hot = await seedItem(app, merchant.id, g.id, 'Formal', 'Hot Blazer');
    const cold = await seedItem(app, merchant.id, g.id, 'Formal', 'Cold Blazer');
    const base = { merchantId: merchant.id, userId: merchantUser.id };
    await seedTryon(app, { ...base, itemId: hot.id, daysAgo: 1 });
    await seedTryon(app, { ...base, itemId: hot.id, daysAgo: 2 });
    await seedTryon(app, { ...base, itemId: cold.id, daysAgo: 3 });
    await seedTryon(app, { ...base, itemId: cold.id, daysAgo: 20 }); // outside 7d
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics?range=7d',
      headers: await authHeader(merchantUser.id),
    });
    const body = res.json();
    expect(body.mostTriedProduct).toEqual({ name: 'Hot Blazer', tryOns: 2 });
    expect(body.leastTriedProduct).toEqual({ name: 'Cold Blazer', tryOns: 1 });
    expect(body.totalTryOns).toBe(3);
  });

  it('rejects an unknown range and unauthenticated callers', async () => {
    const { merchantUser } = await createMerchant(app, 'an-f@example.com');
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics?range=1y',
      headers: await authHeader(merchantUser.id),
    });
    expect(bad.statusCode).toBe(400);
    const anon = await app.inject({ method: 'GET', url: '/v1/merchant/analytics' });
    expect(anon.statusCode).toBe(401);
  });

  const get = async (userId: string, query = '') =>
    app.inject({
      method: 'GET',
      url: `/v1/merchant/analytics${query}`,
      headers: await authHeader(userId),
    });

  it("never resolves another merchant's catalog item named in a job's params", async () => {
    const a = await createMerchant(app, 'an-g@example.com');
    const b = await createMerchant(app, 'an-h@example.com');
    const g = await seedGarmentType(app, 'Gown-g');
    const bItem = await seedItem(app, b.merchant.id, g.id, 'B-Secret-Cat', 'B Secret Gown');
    await seedTryon(app, {
      merchantId: a.merchant.id,
      userId: a.merchantUser.id,
      itemId: bItem.id,
      daysAgo: 1,
    });
    const res = await get(a.merchantUser.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTryOns).toBe(1);
    expect(body.topProducts).toEqual([]);
    expect(body.mostTriedProduct).toBeNull();
    expect(body.categories).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('B Secret Gown');
    expect(JSON.stringify(body)).not.toContain('B-Secret-Cat');
  });

  it('resolves an admin demo catalog item into the rankings', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-i@example.com');
    const g = await seedGarmentType(app, 'Lehenga-i');
    const [set] = await app.db
      .insert(schema.demoCatalogSets)
      .values({ name: 'Demo Set i' })
      .returning();
    const [sub] = await app.db
      .insert(schema.demoCatalogSubcategories)
      .values({ setId: set.id, category: 'women', name: 'Demo Bridal', garmentSubcategoryId: g.id })
      .returning();
    const [demo] = await app.db
      .insert(schema.demoCatalogItems)
      .values({
        subcategoryId: sub.id,
        label: 'Demo Lehenga',
        r2Key: 'k/demo-i',
        thumbnailKey: 't/demo-i',
      })
      .returning();
    await seedTryon(app, {
      merchantId: merchant.id,
      userId: merchantUser.id,
      itemId: demo.id,
      daysAgo: 1,
    });
    const body = (await get(merchantUser.id)).json();
    expect(body.totalTryOns).toBe(1);
    expect(body.topProducts).toEqual([
      { rank: 1, itemId: demo.id, name: 'Demo Lehenga', tryOns: 1 },
    ]);
    expect(body.categories).toEqual([{ name: 'Demo Bridal', tryOns: 1, pct: 100 }]);
  });

  it('counts a deleted item in totals but leaves it out of rankings', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-j@example.com');
    await seedTryon(app, {
      merchantId: merchant.id,
      userId: merchantUser.id,
      itemId: crypto.randomUUID(),
      daysAgo: 1,
    });
    const body = (await get(merchantUser.id)).json();
    expect(body.totalTryOns).toBe(1);
    expect(body.topProducts).toEqual([]);
    expect(body.mostTriedProduct).toBeNull();
    expect(body.categories).toEqual([]);
  });

  it('tolerates a malformed item id in params without a 500', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-k@example.com');
    await seedTryon(app, {
      merchantId: merchant.id,
      userId: merchantUser.id,
      itemId: 'not-a-uuid',
      daysAgo: 1,
    });
    const res = await get(merchantUser.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTryOns).toBe(1);
    expect(body.topProducts).toEqual([]);
  });

  it('breakdownSince is the earliest completed job with an item id, regardless of range', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-l@example.com');
    const g = await seedGarmentType(app, 'Shirt-l');
    const item = await seedItem(app, merchant.id, g.id, 'Casual', 'L Shirt');
    const base = { merchantId: merchant.id, userId: merchantUser.id };
    await seedTryon(app, { ...base, daysAgo: 200 }); // legacy, no id: ignored
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 100, status: 'FAILED' }); // not completed
    const earliestDaysAgo = 60;
    const t0 = Date.now();
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: earliestDaysAgo });
    await seedTryon(app, { ...base, itemId: item.id, daysAgo: 1 });
    const body = (await get(merchantUser.id, '?range=7d')).json();
    const since = new Date(body.breakdownSince).getTime();
    expect(Math.abs(since - (t0 - earliestDaysAgo * 86_400_000))).toBeLessThan(60_000);
  });

  it('breakdownSince ignores two-step (saree) jobs that predate the feature', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-s@example.com');
    const g = await seedGarmentType(app, 'Saree-s');
    const item = await seedItem(app, merchant.id, g.id, 'Silk', 'S Saree');
    const base = { merchantId: merchant.id, userId: merchantUser.id };
    await seedTryon(app, {
      ...base,
      itemId: item.id,
      daysAgo: 200,
      extraParams: { mannequinJobId: '00000000-0000-4000-8000-000000000001' },
    });
    const newer = await seedTryon(app, { ...base, itemId: item.id, daysAgo: 5 });
    const body = (await get(merchantUser.id, '?range=7d')).json();
    expect(body.breakdownSince).toBe(newer.createdAt.toISOString());
  });

  it('ignores completed jobs from other sources', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-m@example.com');
    await seedTryon(app, {
      merchantId: merchant.id,
      userId: merchantUser.id,
      source: JOB_SOURCE.SAREE_MANNEQUIN,
      daysAgo: 1,
    });
    const body = (await get(merchantUser.id)).json();
    expect(body.totalTryOns).toBe(0);
    expect(body.previousTryOns).toBe(0);
  });

  it('defaults to 30d and 90d widens the window', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'an-n@example.com');
    const base = { merchantId: merchant.id, userId: merchantUser.id };
    await seedTryon(app, { ...base, daysAgo: 5 });
    await seedTryon(app, { ...base, daysAgo: 60 });
    const def = (await get(merchantUser.id)).json();
    const span = new Date(def.range.to).getTime() - new Date(def.range.from).getTime();
    expect(span).toBe(30 * 86_400_000);
    expect(def.totalTryOns).toBe(1);
    const wide = (await get(merchantUser.id, '?range=90d')).json();
    expect(wide.totalTryOns).toBe(2);
  });
});
