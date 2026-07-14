import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('catalog', () => {
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

  async function getToken() {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'Catalog User', email: 'catalog@x.com', password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'catalog@x.com'));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'catalog@x.com', password: 'password123' },
    });
    return login.json().accessToken as string;
  }

  async function seedCatalog() {
    const [type] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: 'models', label: 'Models' })
      .returning();
    const [cat] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: type.id, slug: 'women', label: 'Women', sortOrder: 0 })
      .returning();
    await app.db.insert(schema.catalogItems).values({
      categoryId: cat.id,
      label: 'Model A',
      r2Key: 'k1',
      thumbnailKey: 't1',
      sortOrder: 0,
    });
    return type;
  }

  it('GET /v1/catalog/models returns category tree with items', async () => {
    const token = await getToken();
    await seedCatalog();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/catalog/models',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tree[0].children.length).toBe(0);
    expect(res.json().tree[0].items.length).toBe(1);
  });

  it('GET /v1/catalog/lower returns items for a pose whose lower role comes only from catalogue_template_pose_workflows', async () => {
    const token = await getToken();

    // A template-scoped pose with NO default workflowTemplateId of its own — its
    // only workflow role comes from the per-mapping assignment below, matching how
    // real catalogue-template poses work.
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Template-only pose',
        genderSlug: 'women',
        r2Key: 'template-pose.jpg',
        thumbnailKey: 'template-pose-thumb.jpg',
        scope: 'template',
      })
      .returning();
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `catalog-lower-fix-${Date.now()}`,
        label: 'Catalog lower fix test workflow',
        jsonContent: {},
        faceNodeId: '1',
        poseNodeId: '2',
        bgNodeId: '3',
        upperNodeIds: ['4'],
        lowerNodeId: '7',
        facePhasePromptNode: '5',
        garmentPhasePromptNode: '6',
      })
      .returning();
    const [template] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'women', label: 'Catalog lower fix template' })
      .returning();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `catalog-lower-fix-${Date.now()}`,
        label: 'Catalog lower fix type',
      })
      .returning();
    const [mapping] = await app.db
      .insert(schema.catalogueTemplateSubcategories)
      .values({ templateId: template.id, subcategoryId: garmentType.id })
      .returning();
    await app.db.insert(schema.catalogueTemplatePoseWorkflows).values({
      mappingId: mapping.id,
      poseAssetId: pose.id,
      workflowTemplateId: workflow.id,
    });
    await app.db.insert(schema.catalogItems).values({
      type: 'lower',
      genderSlug: 'women',
      label: 'Template lower item',
      r2Key: 'lower-item.jpg',
      thumbnailKey: 'lower-item-thumb.jpg',
      isActive: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/catalog/lower?gender=women&poseIds=${pose.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tree: Array<{ items?: unknown[]; children?: { items?: unknown[] }[] }>;
    };
    const allItems = body.tree.flatMap((node) => [
      ...(node.items ?? []),
      ...(node.children ?? []).flatMap((c) => c.items ?? []),
    ]);
    expect(allItems.length).toBeGreaterThan(0);
  });
});
