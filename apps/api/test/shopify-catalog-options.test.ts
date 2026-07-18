import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 21).toString('base64');
const API_SECRET = 'opt-secret';
const API_KEY = 'opt-key';
let c: Containers;
let app: TestApp;
let token: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  await upsertShopifyStore(
    app,
    {
      shopifyShopId: 601,
      shopDomain: 'catalog-options-test.myshopify.com',
      myshopifyDomain: 'catalog-options-test.myshopify.com',
      name: 'O',
      email: 'o@o.com',
    },
    'tok',
    'read_products',
  );
  token = signSessionToken('catalog-options-test.myshopify.com', API_SECRET, API_KEY);

  await app.db.insert(schema.modelFaces).values({
    gender: 'women',
    label: 'Face A',
    thumbnailKey: 'faces/a.jpg',
    r2Key: 'faces/a-full.jpg',
    isActive: true,
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/catalog/options', () => {
  it('rejects without a session token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=women',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns faces, backgrounds and poses for a gender with a valid session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=women',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      garmentTypes: unknown[];
      faces: { label: string }[];
      backgrounds: unknown[];
      poses: unknown[];
      lowerItems: unknown[];
      shoeItems: unknown[];
    };
    expect(body.faces.some((f) => f.label === 'Face A')).toBe(true);
    expect(Array.isArray(body.backgrounds)).toBe(true);
    expect(Array.isArray(body.poses)).toBe(true);
    expect(Array.isArray(body.lowerItems)).toBe(true);
    expect(Array.isArray(body.shoeItems)).toBe(true);
  });
});
