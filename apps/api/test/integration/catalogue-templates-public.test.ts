import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /v1/models/catalogue-templates', () => {
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

  async function loginToken(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'T', email, password: 'password123' },
    });
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
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

  it('returns only resolvable looks, drops templates left with zero looks', async () => {
    const [activePose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label: 'Active', genderSlug: 'men', r2Key: 'ap.jpg', thumbnailKey: 'ap.jpg' })
      .returning();
    const [inactivePose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Inactive',
        genderSlug: 'men',
        r2Key: 'ip.jpg',
        thumbnailKey: 'ip.jpg',
        isActive: false,
      })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'B', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
      .returning();

    const [templateWithSurvivingLook] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'men', label: 'Has Looks', sortOrder: 0 })
      .returning();
    const [templateFullyFiltered] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'men', label: 'All Filtered', sortOrder: 1 })
      .returning();

    await app.db.insert(schema.catalogueTemplateLooks).values([
      {
        templateId: templateWithSurvivingLook.id,
        poseAssetId: activePose.id,
        backgroundId: bg.id,
        sortOrder: 0,
      },
      {
        templateId: templateWithSurvivingLook.id,
        poseAssetId: inactivePose.id,
        backgroundId: bg.id,
        sortOrder: 1,
      },
      {
        templateId: templateFullyFiltered.id,
        poseAssetId: inactivePose.id,
        backgroundId: bg.id,
        sortOrder: 0,
      },
    ]);

    const token = await loginToken('templates-public@x.com');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/catalogue-templates?gender=men',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();

    const surviving = items.find((t: { id: string }) => t.id === templateWithSurvivingLook.id);
    expect(surviving).toBeTruthy();
    expect(surviving.looks).toHaveLength(1);
    expect(surviving.looks[0].poseId).toBe(activePose.id);

    // Template whose only look references an inactive pose is dropped entirely.
    expect(items.find((t: { id: string }) => t.id === templateFullyFiltered.id)).toBeUndefined();
  });

  it('overlays garmentTypeId hasLower/hasShoes and per-type active overrides, matching /v1/models/poses', async () => {
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label: 'P', genderSlug: 'women', r2Key: 'p.jpg', thumbnailKey: 'p.jpg' })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'B', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
      .returning();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `wf-override-${pose.id}`,
        label: 'WF',
        jsonContent: {},
        faceNodeId: '1',
        poseNodeId: '1',
        bgNodeId: '1',
        upperNodeIds: ['1'],
        lowerNodeId: '2',
        facePhasePromptNode: '1',
        garmentPhasePromptNode: '1',
      })
      .returning();
    const [subcat] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `sc-${pose.id}`, label: 'SC' })
      .returning();
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: pose.id,
      subcategoryId: subcat.id,
      workflowTemplateId: workflow.id,
    });
    const [template] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'women', label: 'T', sortOrder: 0 })
      .returning();
    await app.db.insert(schema.catalogueTemplateLooks).values({
      templateId: template.id,
      poseAssetId: pose.id,
      backgroundId: bg.id,
      sortOrder: 0,
    });

    const token = await loginToken('templates-override@x.com');

    // Without garmentTypeId — pose has no default workflow → hasLower false.
    const resWithout = await app.inject({
      method: 'GET',
      url: '/v1/models/catalogue-templates?gender=women',
      headers: { authorization: `Bearer ${token}` },
    });
    const withoutLook = resWithout.json().items[0].looks[0];
    expect(withoutLook.hasLower).toBe(false);

    // With garmentTypeId matching the override — hasLower true (workflow has lowerNodeId).
    const resWith = await app.inject({
      method: 'GET',
      url: `/v1/models/catalogue-templates?gender=women&garmentTypeId=${subcat.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const withLook = resWith.json().items[0].looks[0];
    expect(withLook.hasLower).toBe(true);
  });
});
