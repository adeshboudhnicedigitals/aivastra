import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('catalog-accessory', () => {
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

  async function getToken(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'Catalog Accessory User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json().accessToken as string;
  }

  it('returns an empty tree when no selected pose has an accessoryNodeId mapped', async () => {
    const token = await getToken('catalog-accessory-empty@x.com');
    const unique = Date.now();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-accessory-none-${unique}`,
        label: 'No accessory node workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: null,
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'No accessory pose',
        genderSlug: 'men',
        r2Key: `no-accessory-pose-${unique}.jpg`,
        thumbnailKey: `no-accessory-pose-${unique}-thumb.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 'accessory', tree: [] });
  });

  it('returns the accessory category tree when a selected pose supports it', async () => {
    const token = await getToken('catalog-accessory-present@x.com');
    const unique = Date.now() + 1;
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-accessory-yes-${unique}`,
        label: 'Accessory node workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: '9',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Accessory pose',
        genderSlug: 'men',
        r2Key: `accessory-pose-${unique}.jpg`,
        thumbnailKey: `accessory-pose-${unique}-thumb.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const [item] = await app.db
      .insert(schema.catalogItems)
      .values({
        type: 'accessory',
        genderSlug: 'men',
        label: `Necklace ${unique}`,
        r2Key: `necklace-${unique}.jpg`,
        thumbnailKey: `necklace-${unique}-thumb.jpg`,
        isActive: true,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json().tree)).toContain(item.label);
  });

  it('filters accessory items by garment-type mapping when garmentTypeId is given', async () => {
    const token = await getToken('catalog-accessory-mapped@x.com');
    const unique = Date.now() + 2;
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-accessory-map-${unique}`,
        label: 'Accessory mapped workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: '9',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Accessory map pose',
        genderSlug: 'men',
        r2Key: `accessory-map-pose-${unique}.jpg`,
        thumbnailKey: `accessory-map-pose-${unique}-thumb.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `catalog-accessory-gt-${unique}`, label: 'Acc GT' })
      .returning();
    const [mapped, unmapped] = await app.db
      .insert(schema.catalogItems)
      .values(
        ['Mapped', 'Unmapped'].map((n) => ({
          type: 'accessory' as const,
          genderSlug: 'men',
          label: `${n} watch ${unique}`,
          r2Key: `${n}-watch-${unique}.jpg`,
          thumbnailKey: `${n}-watch-${unique}-thumb.jpg`,
          isActive: true,
        })),
      )
      .returning();
    await app.db
      .insert(schema.catalogItemSubcategories)
      .values({ catalogItemId: mapped.id, subcategoryId: garmentType.id });

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}&garmentTypeId=${garmentType.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(filtered.statusCode).toBe(200);
    const body = JSON.stringify(filtered.json().tree);
    expect(body).toContain(mapped.label);
    expect(body).not.toContain(unmapped.label);

    // Without garmentTypeId the behaviour is unchanged: both are returned.
    const all = await app.inject({
      method: 'GET',
      url: `/v1/catalog/accessory?gender=men&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const allBody = JSON.stringify(all.json().tree);
    expect(allBody).toContain(mapped.label);
    expect(allBody).toContain(unmapped.label);
  });
});
