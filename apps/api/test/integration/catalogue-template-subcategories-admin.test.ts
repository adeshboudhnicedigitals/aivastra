import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin garment-type <-> catalogue-template mapping', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedGarmentTypeAndTemplates() {
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `sc-${Date.now()}`, label: 'Shirt' })
      .returning();
    const [templateA] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'men', label: 'Template A', sortOrder: 0 })
      .returning();
    const [templateB] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'men', label: 'Template B', sortOrder: 1 })
      .returning();
    // A different-gender template must never appear in this garment type's list.
    const [templateWomen] = await app.db
      .insert(schema.catalogueTemplates)
      .values({ genderSlug: 'women', label: 'Template Women', sortOrder: 0 })
      .returning();
    return { garmentType, templateA, templateB, templateWomen };
  }

  it('GET lists every same-gender template with mapped:false when unmapped', async () => {
    const { garmentType, templateA, templateB, templateWomen } =
      await seedGarmentTypeAndTemplates();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/templates`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();

    const a = items.find((t: { id: string }) => t.id === templateA.id);
    const b = items.find((t: { id: string }) => t.id === templateB.id);
    expect(a.mapped).toBe(false);
    expect(b.mapped).toBe(false);
    expect(items.find((t: { id: string }) => t.id === templateWomen.id)).toBeUndefined();
  });

  it('GET includes the pose IDs used by each template', async () => {
    const { garmentType, templateA, templateB } = await seedGarmentTypeAndTemplates();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Template pose',
        genderSlug: 'men',
        r2Key: 'template-pose.jpg',
        thumbnailKey: 'template-pose-thumb.jpg',
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Template background',
        r2Key: 'template-background.jpg',
        thumbnailKey: 'template-background-thumb.jpg',
      })
      .returning();
    await app.db.insert(schema.catalogueTemplateLooks).values({
      templateId: templateA.id,
      poseAssetId: pose.id,
      backgroundId: background.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/templates`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();

    expect(items.find((t: { id: string }) => t.id === templateA.id).poseAssetIds).toEqual([
      pose.id,
    ]);
    expect(items.find((t: { id: string }) => t.id === templateB.id).poseAssetIds).toEqual([]);
  });

  it('PATCH mapped:true inserts a mapping row, mapped:false removes it', async () => {
    const { garmentType, templateA } = await seedGarmentTypeAndTemplates();

    const enableRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/templates/${templateA.id}`,
      headers,
      payload: { mapped: true },
    });
    expect(enableRes.statusCode).toBe(200);

    const rowsAfterEnable = await app.db
      .select()
      .from(schema.catalogueTemplateSubcategories)
      .where(eq(schema.catalogueTemplateSubcategories.templateId, templateA.id));
    expect(rowsAfterEnable).toHaveLength(1);

    const listRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/templates`,
      headers,
    });
    expect(listRes.json().items.find((t: { id: string }) => t.id === templateA.id).mapped).toBe(
      true,
    );

    const disableRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/templates/${templateA.id}`,
      headers,
      payload: { mapped: false },
    });
    expect(disableRes.statusCode).toBe(200);

    const rowsAfterDisable = await app.db
      .select()
      .from(schema.catalogueTemplateSubcategories)
      .where(eq(schema.catalogueTemplateSubcategories.templateId, templateA.id));
    expect(rowsAfterDisable).toHaveLength(0);
  });

  it('PATCH mapped:true twice is idempotent (no duplicate row, no error)', async () => {
    const { garmentType, templateA } = await seedGarmentTypeAndTemplates();

    await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/templates/${templateA.id}`,
      headers,
      payload: { mapped: true },
    });
    const second = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/templates/${templateA.id}`,
      headers,
      payload: { mapped: true },
    });
    expect(second.statusCode).toBe(200);

    const rows = await app.db
      .select()
      .from(schema.catalogueTemplateSubcategories)
      .where(eq(schema.catalogueTemplateSubcategories.templateId, templateA.id));
    expect(rows).toHaveLength(1);
  });

  it('configures a separate workflow per pose for each garment-template mapping', async () => {
    const { garmentType: shirt, templateA } = await seedGarmentTypeAndTemplates();
    const [suit] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `suit-${Date.now()}`, label: 'Suit' })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Shared template pose',
        genderSlug: 'men',
        r2Key: 'shared-template-pose.jpg',
        thumbnailKey: 'shared-template-pose-thumb.jpg',
        scope: 'template',
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Shared template background',
        r2Key: 'shared-template-background.jpg',
        thumbnailKey: 'shared-template-background-thumb.jpg',
        scope: 'template',
      })
      .returning();
    await app.db.insert(schema.catalogueTemplateLooks).values({
      templateId: templateA.id,
      poseAssetId: pose.id,
      backgroundId: background.id,
    });
    const workflows = await app.db
      .insert(schema.workflowTemplates)
      .values([
        {
          slug: `shirt-workflow-${Date.now()}`,
          label: 'Shirt workflow',
          jsonContent: {},
          faceNodeId: '1',
          poseNodeId: '2',
          bgNodeId: '3',
          upperNodeIds: ['4'],
          facePhasePromptNode: '5',
          garmentPhasePromptNode: '6',
        },
        {
          slug: `suit-workflow-${Date.now()}`,
          label: 'Suit workflow',
          jsonContent: {},
          faceNodeId: '1',
          poseNodeId: '2',
          bgNodeId: '3',
          upperNodeIds: ['4'],
          facePhasePromptNode: '5',
          garmentPhasePromptNode: '6',
        },
      ])
      .returning();

    const mapTemplate = async (garmentTypeId: string) => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/assets/garment-types/${garmentTypeId}/templates/${templateA.id}`,
        headers,
        payload: { mapped: true },
      });
      expect(response.statusCode).toBe(200);
      return response.json().mappingId as string;
    };

    const shirtMappingId = await mapTemplate(shirt.id);
    const suitMappingId = await mapTemplate(suit.id);
    expect(shirtMappingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(suitMappingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(shirtMappingId).not.toBe(suitMappingId);

    for (const [mappingId, workflowTemplateId] of [
      [shirtMappingId, workflows[0]?.id],
      [suitMappingId, workflows[1]?.id],
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses/${pose.id}`,
        headers,
        payload: { workflowTemplateId },
      });
      expect(response.statusCode).toBe(200);
    }

    const [shirtResponse, suitResponse] = await Promise.all(
      [shirtMappingId, suitMappingId].map((mappingId) =>
        app.inject({
          method: 'GET',
          url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses`,
          headers,
        }),
      ),
    );
    expect(shirtResponse.statusCode).toBe(200);
    expect(suitResponse.statusCode).toBe(200);
    expect(shirtResponse.json().items[0].workflowTemplateId).toBe(workflows[0]?.id);
    expect(suitResponse.json().items[0].workflowTemplateId).toBe(workflows[1]?.id);
  });

  it('PATCH sets, preserves, and clears the prompt override independently of the workflow', async () => {
    const { garmentType, templateA } = await seedGarmentTypeAndTemplates();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Prompt override pose',
        genderSlug: 'men',
        r2Key: 'prompt-override-pose.jpg',
        thumbnailKey: 'prompt-override-pose-thumb.jpg',
        scope: 'template',
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Prompt override background',
        r2Key: 'prompt-override-background.jpg',
        thumbnailKey: 'prompt-override-background-thumb.jpg',
        scope: 'template',
      })
      .returning();
    await app.db.insert(schema.catalogueTemplateLooks).values({
      templateId: templateA.id,
      poseAssetId: pose.id,
      backgroundId: background.id,
    });
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `prompt-override-workflow-${Date.now()}`,
        label: 'Prompt override workflow',
        jsonContent: {},
        faceNodeId: '1',
        poseNodeId: '2',
        bgNodeId: '3',
        upperNodeIds: ['4'],
        facePhasePromptNode: '5',
        garmentPhasePromptNode: '6',
      })
      .returning();

    const mapResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/templates/${templateA.id}`,
      headers,
      payload: { mapped: true },
    });
    const mappingId = mapResponse.json().mappingId as string;

    // Set workflow + prompt together.
    const setResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses/${pose.id}`,
      headers,
      payload: { workflowTemplateId: workflow.id, promptGarmentPhase: 'a custom prompt' },
    });
    expect(setResponse.statusCode).toBe(200);

    let getResponse = await app.inject({
      method: 'GET',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses`,
      headers,
    });
    expect(getResponse.json().items[0]).toMatchObject({
      workflowTemplateId: workflow.id,
      promptGarmentPhase: 'a custom prompt',
    });

    // A workflow-only PATCH (promptGarmentPhase omitted) must NOT clobber the saved prompt.
    const workflowOnlyResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses/${pose.id}`,
      headers,
      payload: { workflowTemplateId: workflow.id },
    });
    expect(workflowOnlyResponse.statusCode).toBe(200);

    getResponse = await app.inject({
      method: 'GET',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses`,
      headers,
    });
    expect(getResponse.json().items[0].promptGarmentPhase).toBe('a custom prompt');

    // Explicit null clears it.
    const clearResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses/${pose.id}`,
      headers,
      payload: { workflowTemplateId: workflow.id, promptGarmentPhase: null },
    });
    expect(clearResponse.statusCode).toBe(200);

    getResponse = await app.inject({
      method: 'GET',
      url: `/admin/assets/catalogue-template-mappings/${mappingId}/poses`,
      headers,
    });
    expect(getResponse.json().items[0].promptGarmentPhase).toBeNull();
  });

  it('GET pose-configs excludes template-scoped poses, keeps general-scope poses', async () => {
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `pose-configs-${Date.now()}`, label: 'Shirt' })
      .returning();
    const [generalPose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'General pose',
        genderSlug: 'men',
        r2Key: `general-${Date.now()}.jpg`,
        thumbnailKey: 'general-thumb.jpg',
        scope: 'general',
      })
      .returning();
    const [templatePose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Template-scoped pose',
        genderSlug: 'men',
        r2Key: `template-scoped-${Date.now()}.jpg`,
        thumbnailKey: 'template-scoped-thumb.jpg',
        scope: 'template',
      })
      .returning();

    // Map both poses to garmentType
    await app.db.insert(schema.poseGarmentConfigs).values([
      { poseAssetId: generalPose.id, subcategoryId: garmentType.id, isActive: true },
      { poseAssetId: templatePose.id, subcategoryId: garmentType.id, isActive: true },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();

    expect(items.find((p: { id: string }) => p.id === generalPose.id)).toBeTruthy();
    expect(items.find((p: { id: string }) => p.id === templatePose.id)).toBeUndefined();
  });

  it('GET pose-configs only returns poses explicitly mapped to the garment type', async () => {
    const sfx = Date.now();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `whitelist-gt-${sfx}`, label: 'Shirt' })
      .returning();
    const [poseA] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Pose A ${sfx}`,
        genderSlug: 'men',
        r2Key: `pose-a-${sfx}.jpg`,
        thumbnailKey: `pose-a-thumb-${sfx}.jpg`,
        scope: 'general',
      })
      .returning();
    const [_poseB] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Pose B ${sfx}`,
        genderSlug: 'men',
        r2Key: `pose-b-${sfx}.jpg`,
        thumbnailKey: `pose-b-thumb-${sfx}.jpg`,
        scope: 'general',
      })
      .returning();

    // Initially neither pose is mapped -> empty items
    const initialRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(initialRes.statusCode).toBe(200);
    expect(initialRes.json().items).toHaveLength(0);

    // Map poseA to garmentType
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${poseA.id}`,
      headers,
      payload: {
        isActive: true,
        workflowTemplateId: null,
        promptGarmentPhase: null,
        promptFacePhase: null,
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // Now poseA is returned (isActive: true), unmapped poseB is not returned
    const afterRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(afterRes.statusCode).toBe(200);
    const afterItems = afterRes.json().items;
    expect(afterItems).toHaveLength(1);
    expect(afterItems[0].id).toBe(poseA.id);
    expect(afterItems[0].isActive).toBe(true);

    // Toggle poseA off (isActive: false) -> still in the list, but isActive is false
    const toggleOffRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${poseA.id}`,
      headers,
      payload: {
        isActive: false,
        workflowTemplateId: null,
        promptGarmentPhase: null,
        promptFacePhase: null,
      },
    });
    expect(toggleOffRes.statusCode).toBe(200);

    const toggleOffGetRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(toggleOffGetRes.statusCode).toBe(200);
    const toggleOffItems = toggleOffGetRes.json().items;
    expect(toggleOffItems).toHaveLength(1);
    expect(toggleOffItems[0].id).toBe(poseA.id);
    expect(toggleOffItems[0].isActive).toBe(false);

    // DELETE poseA mapping -> pose is completely unmapped
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${poseA.id}`,
      headers,
    });
    expect(deleteRes.statusCode).toBe(200);

    const finalGetRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(finalGetRes.statusCode).toBe(200);
    expect(finalGetRes.json().items).toHaveLength(0);

    // GET /admin/assets/pose-assets/:id/garment-configs reflects unmapped
    const poseGarmentRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/pose-assets/${poseA.id}/garment-configs`,
      headers,
    });
    expect(poseGarmentRes.statusCode).toBe(200);
    const gtItem = poseGarmentRes.json().items.find((g: { id: string }) => g.id === garmentType.id);
    expect(gtItem?.isActive).toBe(false);
  });

  it('clearing all overrides fully unmaps a pose even if it was manually reordered', async () => {
    const sfx = Date.now();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `clear-override-gt-${sfx}`, label: 'Shirt' })
      .returning();
    const [poseA] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Clear override pose ${sfx}`,
        genderSlug: 'men',
        r2Key: `clear-override-${sfx}.jpg`,
        thumbnailKey: `clear-override-thumb-${sfx}.jpg`,
        scope: 'general',
      })
      .returning();

    // Map it and give it a materialized sortOrder via the reorder path.
    const sortRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${poseA.id}`,
      headers,
      payload: {
        isActive: true,
        workflowTemplateId: null,
        promptGarmentPhase: null,
        promptFacePhase: null,
        sortOrder: 1,
      },
    });
    expect(sortRes.statusCode).toBe(200);

    // "Clear override" — all override fields null, no sortOrder key — must fully
    // unmap the pose, not leave a zombie row alive just to keep its position.
    const clearRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${poseA.id}`,
      headers,
      payload: {
        isActive: null,
        workflowTemplateId: null,
        promptGarmentPhase: null,
        promptFacePhase: null,
      },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().action).toBe('deleted');

    const afterGetRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(afterGetRes.json().items).toHaveLength(0);
  });

  it('GET face-mappings starts empty, PATCH mappedFaceIds replaces the set, empty array clears it', async () => {
    const sfx = Date.now();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `face-map-gt-${sfx}`, label: 'Dress' })
      .returning();
    const [faceA] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Admin Face A ${sfx}`,
        r2Key: `admin-face-a-${sfx}.jpg`,
        thumbnailKey: `admin-face-a-thumb-${sfx}.jpg`,
      })
      .returning();
    const [faceB] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Admin Face B ${sfx}`,
        r2Key: `admin-face-b-${sfx}.jpg`,
        thumbnailKey: `admin-face-b-thumb-${sfx}.jpg`,
      })
      .returning();
    if (!garmentType || !faceA || !faceB) throw new Error('fixtures not created');

    const initialRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/face-mappings`,
      headers,
    });
    expect(initialRes.statusCode).toBe(200);
    expect(initialRes.json()).toEqual({ mappedFaceIds: [], hasExplicitFaceMappings: false });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}`,
      headers,
      payload: { mappedFaceIds: [faceA.id, faceB.id] },
    });
    expect(patchRes.statusCode).toBe(200);

    const afterMapRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/face-mappings`,
      headers,
    });
    const afterMap = afterMapRes.json();
    expect(afterMap.hasExplicitFaceMappings).toBe(true);
    expect(new Set(afterMap.mappedFaceIds)).toEqual(new Set([faceA.id, faceB.id]));

    // Replace the set down to just faceA.
    await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}`,
      headers,
      payload: { mappedFaceIds: [faceA.id] },
    });
    const afterReplaceRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/face-mappings`,
      headers,
    });
    expect(afterReplaceRes.json()).toEqual({
      mappedFaceIds: [faceA.id],
      hasExplicitFaceMappings: true,
    });

    // Clearing to an empty array drops every row, reverting to the unmapped state.
    await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}`,
      headers,
      payload: { mappedFaceIds: [] },
    });
    const afterClearRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/face-mappings`,
      headers,
    });
    expect(afterClearRes.json()).toEqual({ mappedFaceIds: [], hasExplicitFaceMappings: false });
  });

  it('multi-sorts mapped poses by moving selected poses to a target start position', async () => {
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ label: 'MultiSort GT', slug: 'multisort-gt', genderSlug: 'men' })
      .returning();

    const [poseA, poseB, poseC] = await app.db
      .insert(schema.modelPoseAssets)
      .values([
        {
          label: 'pose-a',
          genderSlug: 'men',
          scope: 'general',
          r2Key: 'poses/a.jpg',
          thumbnailKey: 'poses/a_thumb.jpg',
          sortOrder: 1,
        },
        {
          label: 'pose-b',
          genderSlug: 'men',
          scope: 'general',
          r2Key: 'poses/b.jpg',
          thumbnailKey: 'poses/b_thumb.jpg',
          sortOrder: 2,
        },
        {
          label: 'pose-c',
          genderSlug: 'men',
          scope: 'general',
          r2Key: 'poses/c.jpg',
          thumbnailKey: 'poses/c_thumb.jpg',
          sortOrder: 3,
        },
      ])
      .returning();

    // Map all three poses to the garment type
    for (const [p, order] of [
      [poseA, 1],
      [poseB, 2],
      [poseC, 3],
    ] as const) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/${p.id}`,
        headers,
        payload: {
          isActive: true,
          sortOrder: order,
          workflowTemplateId: null,
          promptGarmentPhase: null,
          promptFacePhase: null,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    // Verify initial order: poseA, poseB, poseC
    const initialRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(initialRes.statusCode).toBe(200);
    const initialIds = initialRes.json().items.map((i: { id: string }) => i.id);
    expect(initialIds).toEqual([poseA.id, poseB.id, poseC.id]);

    // Multi-sort: move poseC to start at position 1
    const multiSortRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/multi-sort`,
      headers,
      payload: {
        poseAssetIds: [poseC.id],
        startSortOrder: 1,
      },
    });
    expect(multiSortRes.statusCode).toBe(200);
    expect(multiSortRes.json().ok).toBe(true);

    // Verify new order: poseC, poseA, poseB
    const afterSortRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(afterSortRes.statusCode).toBe(200);
    const afterSortIds = afterSortRes.json().items.map((i: { id: string }) => i.id);
    expect(afterSortIds).toEqual([poseC.id, poseA.id, poseB.id]);

    // Multi-sort: move [poseA, poseB] to start at position 1 (reverses poseC back to end)
    const multiSortRes2 = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs/multi-sort`,
      headers,
      payload: {
        poseAssetIds: [poseA.id, poseB.id],
        startSortOrder: 1,
      },
    });
    expect(multiSortRes2.statusCode).toBe(200);

    const afterSortRes2 = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/pose-configs`,
      headers,
    });
    expect(afterSortRes2.statusCode).toBe(200);
    const afterSortIds2 = afterSortRes2.json().items.map((i: { id: string }) => i.id);
    expect(afterSortIds2).toEqual([poseA.id, poseB.id, poseC.id]);
  });

  it('handles catalog-mappings GET, PATCH with mappedLowerCatalogItemIds, and PUT unmap/map', async () => {
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `sc-cat-${Date.now()}`, label: 'Kurta Test' })
      .returning();

    const [lower1, lower2] = await app.db
      .insert(schema.catalogItems)
      .values([
        {
          type: 'lower',
          genderSlug: 'women',
          label: `Lower 1 ${Date.now()}`,
          r2Key: 'l1.jpg',
          thumbnailKey: 'l1-thumb.jpg',
          isActive: true,
        },
        {
          type: 'lower',
          genderSlug: 'women',
          label: `Lower 2 ${Date.now()}`,
          r2Key: 'l2.jpg',
          thumbnailKey: 'l2-thumb.jpg',
          isActive: true,
        },
      ])
      .returning();

    // 1. Initial mappings should be empty
    const initRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-mappings`,
      headers,
    });
    expect(initRes.statusCode).toBe(200);
    expect(initRes.json().mappedLowerIds).toEqual([]);
    expect(initRes.json().hasExplicitLowerMappings).toBe(false);

    // 2. PATCH garment type with mappedLowerCatalogItemIds = [lower1.id]
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${garmentType.id}`,
      headers,
      payload: {
        mappedLowerCatalogItemIds: [lower1.id],
      },
    });
    expect(patchRes.statusCode).toBe(200);

    const afterPatchRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-mappings`,
      headers,
    });
    expect(afterPatchRes.statusCode).toBe(200);
    expect(afterPatchRes.json().mappedLowerIds).toEqual([lower1.id]);
    expect(afterPatchRes.json().hasExplicitLowerMappings).toBe(true);

    // 3. PUT map lower2 as well
    const putMapRes = await app.inject({
      method: 'PUT',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-items/${lower2.id}`,
      headers,
      payload: { mapped: true },
    });
    expect(putMapRes.statusCode).toBe(200);

    const afterPutMapRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-mappings`,
      headers,
    });
    expect(afterPutMapRes.json().mappedLowerIds).toContain(lower1.id);
    expect(afterPutMapRes.json().mappedLowerIds).toContain(lower2.id);

    // 4. PUT unmap lower1
    const putUnmapRes = await app.inject({
      method: 'PUT',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-items/${lower1.id}`,
      headers,
      payload: { mapped: false },
    });
    expect(putUnmapRes.statusCode).toBe(200);

    const afterUnmapRes = await app.inject({
      method: 'GET',
      url: `/admin/assets/garment-types/${garmentType.id}/catalog-mappings`,
      headers,
    });
    expect(afterUnmapRes.json().mappedLowerIds).not.toContain(lower1.id);
    expect(afterUnmapRes.json().mappedLowerIds).toContain(lower2.id);
  });
});
