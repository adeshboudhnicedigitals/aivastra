import { Buffer } from 'node:buffer';
import { createHmac, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const SECRET = 'login-required-test-secret';
const PRODUCT_ID = 7001;
const EMAIL = 'shopper@example.com';

function signAppProxyQuery(params: Record<string, string>): Record<string, string> {
  const msg = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('');
  return { ...params, signature: createHmac('sha256', SECRET).update(msg).digest('hex') };
}

describe('Shopify login-required try-on creation', () => {
  let ctx: Containers;
  let app: TestApp;
  let storeNumber = 0;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx, { SHOPIFY_API_SECRET: SECRET });
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `login-required-${Date.now()}`,
        label: 'Login required integration workflow',
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
    await app.redis.set(
      'config:system',
      JSON.stringify({ shopifyWorkflowTemplateId: workflow.id }),
    );
  });

  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedStore(
    limits: { loginRequired?: boolean; perShopperCap?: number; perShopperWindow?: 'day' } = {
      loginRequired: true,
    },
  ) {
    const n = storeNumber++;
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `login-required-${Date.now()}-${n}.myshopify.com`,
        shopifyShopId: Date.now() * 1000 + n,
        accessToken: 'enc',
        scope: 'read_products',
        settings: { limits },
      })
      .returning();
    await app.db.insert(schema.shopifyStoreCredits).values({ storeId: store.id, balance: 100 });
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: PRODUCT_ID,
      r2Key: `shopify-garments/${store.id}/${PRODUCT_ID}/garment.jpg`,
      title: 'Test Product',
      status: 'active',
      enabled: true,
    });
    return store;
  }

  async function uploadPhoto(store: { storeKey: string }) {
    const bytes = Buffer.from('photo-bytes');
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/presign',
      headers: { 'x-widget-key': store.storeKey },
      payload: { contentType: 'image/jpeg', contentLength: bytes.length },
    });
    expect(presign.statusCode).toBe(200);
    const { uploadUrl, r2Key } = presign.json() as { uploadUrl: string; r2Key: string };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    expect(put.ok).toBe(true);
    return r2Key;
  }

  function postJob(
    store: { shopDomain: string; storeKey: string },
    body: Record<string, unknown>,
    opts: { signed: boolean; loggedInCustomerId?: string },
  ) {
    const params: Record<string, string> = {
      shop: store.shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    if (opts.loggedInCustomerId !== undefined)
      params.logged_in_customer_id = opts.loggedInCustomerId;
    return app.inject({
      method: 'POST',
      url: opts.signed ? '/v1/shopify/proxy/customer/jobs' : '/v1/shopify/customer/jobs',
      query: opts.signed ? signAppProxyQuery(params) : undefined,
      headers: opts.signed ? {} : { 'x-widget-key': store.storeKey },
      payload: body,
    });
  }

  const body = (photo: string, fields: Record<string, unknown> = {}) => ({
    customerPhotoKey: photo,
    shopifyProductId: PRODUCT_ID,
    clientId: randomUUID(),
    ...fields,
  });

  async function jobsFor(storeId: string) {
    return app.db.select().from(schema.jobs).where(eq(schema.jobs.shopifyStoreId, storeId));
  }

  async function balanceFor(storeId: string) {
    const [row] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, storeId));
    return row.balance;
  }

  async function refusalEvents(storeId: string, type: string) {
    return app.db
      .select()
      .from(schema.shopifyWidgetEvents)
      .where(
        and(
          eq(schema.shopifyWidgetEvents.storeId, storeId),
          eq(schema.shopifyWidgetEvents.type, type),
        ),
      );
  }

  async function expectLoginRefusal(
    store: Awaited<ReturnType<typeof seedStore>>,
    request: ReturnType<typeof postJob>,
  ) {
    const response = await request;
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      reason: 'login_required',
      message: expect.any(String),
    });
    expect(await jobsFor(store.id)).toHaveLength(0);
    expect(await balanceFor(store.id)).toBe(100);
    expect(await refusalEvents(store.id, 'refused_login_gate')).toHaveLength(1);
  }

  it('refuses a direct widget-key request even when the body claims identity and contact', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    await expectLoginRefusal(
      store,
      postJob(
        store,
        body(photo, {
          shopifyCustomerId: 111,
          email: EMAIL,
        }),
        { signed: false },
      ),
    );
  });

  it('refuses a signed proxy request with an empty logged-in customer id', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    await expectLoginRefusal(
      store,
      postJob(
        store,
        body(photo, {
          shopifyCustomerId: 111,
          email: EMAIL,
        }),
        { signed: true, loggedInCustomerId: '' },
      ),
    );
  });

  it('refuses a signed proxy request with no logged-in customer id parameter', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    await expectLoginRefusal(
      store,
      postJob(
        store,
        body(photo, {
          shopifyCustomerId: 111,
          email: EMAIL,
        }),
        { signed: true },
      ),
    );
  });

  it('requires clientId after login to make a shopper row', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    const response = await postJob(
      store,
      {
        customerPhotoKey: photo,
        shopifyProductId: PRODUCT_ID,
        email: EMAIL,
      },
      { signed: true, loggedInCustomerId: '111' },
    );
    expect(response.statusCode).toBe(400);
    expect(await jobsFor(store.id)).toHaveLength(0);
    expect(await balanceFor(store.id)).toBe(100);
  });

  it('refuses a logged-in shopper without an email', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    const response = await postJob(store, body(photo), { signed: true, loggedInCustomerId: '111' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      reason: 'contact_required',
      message: expect.any(String),
    });
    expect(await refusalEvents(store.id, 'refused_contact_gate')).toHaveLength(1);
    expect(await jobsFor(store.id)).toHaveLength(0);
    expect(await balanceFor(store.id)).toBe(100);
  });

  it('accepts an email on a retry by the same logged-in shopper', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    const clientId = randomUUID();
    const first = await postJob(store, body(photo, { clientId }), {
      signed: true,
      loggedInCustomerId: '111',
    });
    expect(first.statusCode).toBe(202);
    expect(first.json().reason).toBe('contact_required');
    const second = await postJob(store, body(photo, { clientId, email: EMAIL }), {
      signed: true,
      loggedInCustomerId: '111',
    });
    expect(second.statusCode).toBe(201);
    expect(await jobsFor(store.id)).toHaveLength(1);
    const [shopper] = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(
        and(
          eq(schema.shopifyShoppers.storeId, store.id),
          eq(schema.shopifyShoppers.clientId, clientId),
        ),
      );
    expect(shopper).toMatchObject({ email: EMAIL, shopifyCustomerId: 111 });
  });

  it('does not carry the previous customer contact to a different customer on the same browser', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    const clientId = randomUUID();
    const first = await postJob(store, body(photo, { clientId, email: EMAIL }), {
      signed: true,
      loggedInCustomerId: '111',
    });
    expect(first.statusCode).toBe(201);
    // Customer 222 logs in on the same browser and supplies no contact data.
    const second = await postJob(store, body(photo, { clientId }), {
      signed: true,
      loggedInCustomerId: '222',
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().reason).toBe('contact_required');
    const [shopper] = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(
        and(
          eq(schema.shopifyShoppers.storeId, store.id),
          eq(schema.shopifyShoppers.clientId, clientId),
        ),
      );
    expect(shopper).toMatchObject({ shopifyCustomerId: 222, email: null });
  });

  it('uses the signed customer id when the body claims another id', async () => {
    const store = await seedStore();
    const photo = await uploadPhoto(store);
    const response = await postJob(
      store,
      body(photo, {
        shopifyCustomerId: 999,
        email: EMAIL,
      }),
      { signed: true, loggedInCustomerId: '111' },
    );
    expect(response.statusCode).toBe(201);
    const [job] = await jobsFor(store.id);
    const [shopper] = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(eq(schema.shopifyShoppers.id, job.shopifyShopperId as string));
    expect(shopper.shopifyCustomerId).toBe(111);
  });

  it('keeps the direct anonymous path working for stores without loginRequired', async () => {
    const store = await seedStore({});
    const photo = await uploadPhoto(store);
    const response = await postJob(store, body(photo), { signed: false });
    expect(response.statusCode).toBe(201);
    expect(await jobsFor(store.id)).toHaveLength(1);
  });

  it('returns the loginRequired setting from enabled for both store kinds', async () => {
    const required = await seedStore();
    const optional = await seedStore({});
    for (const [store, expected] of [
      [required, true],
      [optional, false],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/shopify/customer/products/${PRODUCT_ID}/enabled`,
        headers: { 'x-widget-key': store.storeKey },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ enabled: true, loginRequired: expected });
    }
  });

  it('counts a verified customer across browsers for the per-shopper cap', async () => {
    const store = await seedStore({
      loginRequired: true,
      perShopperCap: 1,
      perShopperWindow: 'day',
    });
    const photo = await uploadPhoto(store);
    const first = await postJob(store, body(photo, { email: EMAIL }), {
      signed: true,
      loggedInCustomerId: '111',
    });
    expect(first.statusCode).toBe(201);
    const second = await postJob(store, body(photo, { email: EMAIL }), {
      signed: true,
      loggedInCustomerId: '111',
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().reason).toBe('shopper_limit');
    expect(await jobsFor(store.id)).toHaveLength(1);
    expect(await refusalEvents(store.id, 'refused_shopper_cap')).toHaveLength(1);
  });
});
