import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

// Repro for: "clicking on a body type in studio crashes the page" — reported right
// after shipping the seed-toggle + its opt-out fix. Exercises the exact sequence a
// real session does: seed a body type via the admin endpoints the modal calls, then
// hit the three public endpoints the studio page queries on body-type click.
describe('body type click after seeding — repro', () => {
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

  it('garment-types/faces/poses all return 200 for a freshly seeded body type', async () => {
    const admin = await adminAuthHeader(app);
    const { token } = await createVerifiedUserToken(app, `studio-repro-${Date.now()}@x.com`);
    const user = { authorization: `Bearer ${token}` };

    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: 'repro-shirt', label: 'Repro Shirt' })
      .returning();
    if (!garmentType) throw new Error('garment type not created');

    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'Repro Face',
        r2Key: 'repro-face.jpg',
        thumbnailKey: 'repro-face-thumb.jpg',
      })
      .returning();
    if (!face) throw new Error('face not created');
    // Explicit mapping so this face is reachable through the garment type —
    // mirrors what the seed endpoint reads via model_face_subcategories.
    await app.db
      .insert(schema.modelFaceSubcategories)
      .values({ faceId: face.id, subcategoryId: garmentType.id });

    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `repro-wf-${Date.now()}`,
        label: 'Repro workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['1'],
        lowerNodeId: null,
        garmentPhasePromptNode: '6',
      })
      .returning();
    if (!workflow) throw new Error('workflow not created');

    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Repro Pose',
        genderSlug: 'men',
        r2Key: 'repro-pose.jpg',
        thumbnailKey: 'repro-pose-thumb.jpg',
        workflowTemplateId: workflow.id,
      })
      .returning();
    if (!pose) throw new Error('pose not created');
    // pose_garment_configs is strict opt-in — this is what makes the pose
    // reachable for this garment type at all.
    await app.db
      .insert(schema.poseGarmentConfigs)
      .values({ poseAssetId: pose.id, subcategoryId: garmentType.id });

    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/assets/body-types',
      headers: admin,
      payload: { genderSlug: 'men', label: `Repro Body Type ${Date.now()}`, sortOrder: 0 },
    });
    expect(createRes.statusCode).toBe(200);
    const bodyType = createRes.json();

    const seedSourceRes = await app.inject({
      method: 'GET',
      url: '/admin/assets/body-types/garment-mapped-assets?genderSlug=men',
      headers: admin,
    });
    expect(seedSourceRes.statusCode).toBe(200);
    const { faceIds, poseAssetIds } = seedSourceRes.json();
    expect(faceIds).toContain(face.id);
    expect(poseAssetIds).toContain(pose.id);

    for (const faceId of faceIds) {
      const r = await app.inject({
        method: 'PUT',
        url: `/admin/assets/body-types/${bodyType.id}/faces/${faceId}`,
        headers: admin,
        payload: { mapped: true },
      });
      expect(r.statusCode).toBe(200);
    }
    for (const poseAssetId of poseAssetIds) {
      const r = await app.inject({
        method: 'PUT',
        url: `/admin/assets/body-types/${bodyType.id}/poses/${poseAssetId}`,
        headers: admin,
        payload: { mapped: true },
      });
      expect(r.statusCode).toBe(200);
    }

    // Now reproduce exactly what the studio page requests on a body-type click.
    const garmentTypesRes = await app.inject({
      method: 'GET',
      url: `/v1/models/garment-types?gender=men&bodyTypeId=${bodyType.id}`,
      headers: user,
    });
    expect(garmentTypesRes.statusCode).toBe(200);
    expect(garmentTypesRes.json().items.some((i: { id: string }) => i.id === garmentType.id)).toBe(
      true,
    );

    const facesRes = await app.inject({
      method: 'GET',
      url: `/v1/models/faces?gender=men&garmentTypeId=${garmentType.id}&bodyTypeId=${bodyType.id}`,
      headers: user,
    });
    expect(facesRes.statusCode).toBe(200);
    expect(facesRes.json().items.some((i: { id: string }) => i.id === face.id)).toBe(true);

    const posesRes = await app.inject({
      method: 'GET',
      url: `/v1/models/poses?gender=men&garmentTypeId=${garmentType.id}&bodyTypeId=${bodyType.id}`,
      headers: user,
    });
    expect(posesRes.statusCode).toBe(200);
    expect(posesRes.json().items.some((i: { id: string }) => i.id === pose.id)).toBe(true);

    // And without a garmentTypeId yet — the first render after clicking a body type,
    // before the auto-select effect has picked a garment type.
    const facesNoGarmentRes = await app.inject({
      method: 'GET',
      url: `/v1/models/faces?gender=men&bodyTypeId=${bodyType.id}`,
      headers: user,
    });
    expect(facesNoGarmentRes.statusCode).toBe(200);

    const posesNoGarmentRes = await app.inject({
      method: 'GET',
      url: `/v1/models/poses?gender=men&bodyTypeId=${bodyType.id}`,
      headers: user,
    });
    expect(posesNoGarmentRes.statusCode).toBe(200);
  });
});
