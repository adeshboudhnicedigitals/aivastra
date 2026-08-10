import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bumpCatalogOptionsVersion } from '../src/lib/catalog-options-cache.js';
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

async function seedWorkflow(overrides: {
  lowerNodeId?: string | null;
  shoeNodeId?: string | null;
}) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `wf-${Date.now()}-${Math.random()}`,
      label: 'Workflow',
      jsonContent: {},
      faceNodeId: '1',
      poseNodeId: '2',
      bgNodeId: '3',
      upperNodeIds: ['4'],
      lowerNodeId: overrides.lowerNodeId ?? null,
      shoeNodeId: overrides.shoeNodeId ?? null,
      facePhasePromptNode: '5',
      garmentPhasePromptNode: '6',
    })
    .returning();
  return wf;
}

/**
 * The options payload is Redis-cached and invalidated by an onResponse hook on
 * /admin/assets and /admin/catalog writes (plugins/catalog-cache-invalidation.ts).
 * These tests seed assets straight into Postgres, bypassing that hook entirely, so
 * they must invalidate explicitly — otherwise a later assertion reads the payload an
 * earlier test in this file already warmed.
 */
async function seeded() {
  await bumpCatalogOptionsVersion(app);
}

describe('GET /v1/shopify/catalog/options', () => {
  it('rejects without a session token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=women',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 401 (not 400) when the querystring is malformed and there is no session token', async () => {
    // gender is required/enum — omitting it entirely makes the querystring invalid.
    // Auth must run before validation, so this must still be 401, not 400. Proves the
    // preHandler-then-manual-parse fix (mirroring generate's own equivalent fix).
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options',
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

  it('gender-scopes backgrounds: genderSlug-specific rows only match their gender, null-genderSlug rows match every gender', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    await app.db.insert(schema.modelBackgrounds).values({
      label: `Men Only BG ${tag}`,
      r2Key: `bg-men-${tag}.jpg`,
      thumbnailKey: `bg-men-thumb-${tag}.jpg`,
      genderSlug: 'men',
      scope: 'general',
      isActive: true,
    });
    await app.db.insert(schema.modelBackgrounds).values({
      label: `All Genders BG ${tag}`,
      r2Key: `bg-all-${tag}.jpg`,
      thumbnailKey: `bg-all-thumb-${tag}.jpg`,
      genderSlug: null,
      scope: 'general',
      isActive: true,
    });
    await seeded();

    const resWomen = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=women',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resWomen.statusCode).toBe(200);
    const womenBody = resWomen.json() as { backgrounds: { label: string }[] };
    expect(womenBody.backgrounds.some((b) => b.label === `Men Only BG ${tag}`)).toBe(false);
    expect(womenBody.backgrounds.some((b) => b.label === `All Genders BG ${tag}`)).toBe(true);

    const resMen = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=men',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resMen.statusCode).toBe(200);
    const menBody = resMen.json() as { backgrounds: { label: string }[] };
    expect(menBody.backgrounds.some((b) => b.label === `Men Only BG ${tag}`)).toBe(true);
    expect(menBody.backgrounds.some((b) => b.label === `All Genders BG ${tag}`)).toBe(true);
  });

  it('overlays poseGarmentConfigs for garmentTypeId: overrides hasLower/hasShoes and excludes poses inactive for that type', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `sc-${tag}`, label: 'Shirt', isActive: true })
      .returning();

    // Default workflow: hasLower true, hasShoes false.
    const defaultWf = await seedWorkflow({ lowerNodeId: '10', shoeNodeId: null });
    // Override workflow: hasLower false, hasShoes true — the inverse, so the test can't
    // pass by accident if the overlay is silently skipped.
    const overrideWf = await seedWorkflow({ lowerNodeId: null, shoeNodeId: '11' });

    const [overriddenPose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Overridden Pose ${tag}`,
        genderSlug: 'women',
        r2Key: `pose-override-${tag}.jpg`,
        thumbnailKey: `pose-override-thumb-${tag}.jpg`,
        scope: 'general',
        isActive: true,
        workflowTemplateId: defaultWf.id,
      })
      .returning();
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: overriddenPose.id,
      subcategoryId: garmentType.id,
      workflowTemplateId: overrideWf.id,
      isActive: true,
    });

    const [inactivePose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Inactive-For-Type Pose ${tag}`,
        genderSlug: 'women',
        r2Key: `pose-inactive-${tag}.jpg`,
        thumbnailKey: `pose-inactive-thumb-${tag}.jpg`,
        scope: 'general',
        isActive: true,
        workflowTemplateId: defaultWf.id,
      })
      .returning();
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: inactivePose.id,
      subcategoryId: garmentType.id,
      isActive: false,
    });
    await seeded();

    // Without garmentTypeId: both poses reflect their own default workflow (hasLower
    // true, hasShoes false) and the inactive-for-type pose is NOT excluded.
    const resNoType = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/options?gender=women',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resNoType.statusCode).toBe(200);
    const bodyNoType = resNoType.json() as {
      poses: { id: string; hasLower: boolean; hasShoes: boolean }[];
    };
    const overriddenNoType = bodyNoType.poses.find((p) => p.id === overriddenPose.id);
    expect(overriddenNoType).toMatchObject({ hasLower: true, hasShoes: false });
    expect(bodyNoType.poses.some((p) => p.id === inactivePose.id)).toBe(true);

    // With garmentTypeId: overridden pose reflects the override workflow, and the
    // inactive-for-type pose is excluded entirely.
    const resWithType = await app.inject({
      method: 'GET',
      url: `/v1/shopify/catalog/options?gender=women&garmentTypeId=${garmentType.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resWithType.statusCode).toBe(200);
    const bodyWithType = resWithType.json() as {
      poses: { id: string; hasLower: boolean; hasShoes: boolean }[];
    };
    const overriddenWithType = bodyWithType.poses.find((p) => p.id === overriddenPose.id);
    expect(overriddenWithType).toMatchObject({ hasLower: false, hasShoes: true });
    expect(bodyWithType.poses.some((p) => p.id === inactivePose.id)).toBe(false);
  });
});
