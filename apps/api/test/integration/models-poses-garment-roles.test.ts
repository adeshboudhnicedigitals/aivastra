import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const secret = new TextEncoder().encode('test-jwt-secret-0123456789abcdef-32min');

// The studio decides whether one upload can stand in as the lower garment from
// hasUpper/hasLower; a sole-lower pose is rejected by createJob without a lower upload.
describe('GET /v1/models/poses — garment roles', () => {
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

  async function token(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true })
      .returning();
    if (!user) throw new Error('user not created');
    return signAccess(secret, user.id, { kind: 'access' }, '15m');
  }

  async function workflow(
    slug: string,
    upperNodeIds: string[],
    lowerNodeId: string | null,
    accessoryNodeId: string | null = null,
  ) {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug,
        label: slug,
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds,
        lowerNodeId,
        accessoryNodeId,
        garmentPhasePromptNode: '6',
      })
      .returning();
    if (!wf) throw new Error('workflow not created');
    return wf;
  }

  async function pose(label: string, workflowTemplateId: string | null) {
    const [p] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label,
        genderSlug: 'boys',
        r2Key: `${label}.jpg`,
        thumbnailKey: `${label}.jpg`,
        workflowTemplateId,
      })
      .returning();
    if (!p) throw new Error('pose not created');
    return p;
  }

  it('reports hasUpper=false for a sole-lower workflow and true for a full outfit', async () => {
    const sfx = Date.now();
    const lowerOnly = await workflow(`roles-lower-only-${sfx}`, [], '7');
    const fullOutfit = await workflow(`roles-full-${sfx}`, ['1'], '7');
    const upperOnly = await workflow(`roles-upper-${sfx}`, ['1'], null);
    const pLower = await pose(`roles-p-lower-${sfx}`, lowerOnly.id);
    const pFull = await pose(`roles-p-full-${sfx}`, fullOutfit.id);
    const pUpper = await pose(`roles-p-upper-${sfx}`, upperOnly.id);
    const pNone = await pose(`roles-p-none-${sfx}`, null);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/poses?gender=boys',
      headers: { authorization: `Bearer ${await token(`roles-default-${sfx}@x.com`)}` },
    });
    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().items as { id: string; hasUpper: boolean; hasLower: boolean }[]).map((i) => [
        i.id,
        i,
      ]),
    );
    expect(byId.get(pLower.id)).toMatchObject({ hasUpper: false, hasLower: true });
    expect(byId.get(pFull.id)).toMatchObject({ hasUpper: true, hasLower: true });
    expect(byId.get(pUpper.id)).toMatchObject({ hasUpper: true, hasLower: false });
    expect(byId.get(pNone.id)).toMatchObject({ hasUpper: false, hasLower: false });
  });

  it('reports hasAccessory based on the resolved workflow template', async () => {
    const sfx = Date.now() + 3;
    const withAccessory = await workflow(`roles-accessory-yes-${sfx}`, ['1'], null, '9');
    const withoutAccessory = await workflow(`roles-accessory-no-${sfx}`, ['1'], null, null);
    const pWith = await pose(`roles-p-accessory-yes-${sfx}`, withAccessory.id);
    const pWithout = await pose(`roles-p-accessory-no-${sfx}`, withoutAccessory.id);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/poses?gender=boys',
      headers: { authorization: `Bearer ${await token(`roles-accessory-${sfx}@x.com`)}` },
    });
    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().items as { id: string; hasAccessory: boolean }[]).map((i) => [i.id, i]),
    );
    expect(byId.get(pWith.id)).toMatchObject({ hasAccessory: true });
    expect(byId.get(pWithout.id)).toMatchObject({ hasAccessory: false });
  });

  it('applies a per-garment-type workflow override to hasUpper/hasLower', async () => {
    const sfx = Date.now() + 1;
    const fullOutfit = await workflow(`roles-ovr-default-${sfx}`, ['1'], null);
    const lowerOnly = await workflow(`roles-ovr-lower-${sfx}`, [], '7');
    const p = await pose(`roles-ovr-pose-${sfx}`, fullOutfit.id);
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'boys', slug: `roles-ovr-gt-${sfx}`, label: 'Roles override' })
      .returning();
    if (!garmentType) throw new Error('garment type not created');
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: p.id,
      subcategoryId: garmentType.id,
      workflowTemplateId: lowerOnly.id,
    });
    const auth = { authorization: `Bearer ${await token(`roles-override-${sfx}@x.com`)}` };

    const find = async (url: string) => {
      const res = await app.inject({ method: 'GET', url, headers: auth });
      return (res.json().items as { id: string; hasUpper: boolean; hasLower: boolean }[]).find(
        (i) => i.id === p.id,
      );
    };
    expect(await find('/v1/models/poses?gender=boys')).toMatchObject({
      hasUpper: true,
      hasLower: false,
    });
    expect(
      await find(`/v1/models/poses?gender=boys&garmentTypeId=${garmentType.id}`),
    ).toMatchObject({ hasUpper: false, hasLower: true });
  });

  it('a prompt-only override keeps the pose default roles', async () => {
    const sfx = Date.now() + 2;
    const lowerOnly = await workflow(`roles-prompt-${sfx}`, [], '7');
    const p = await pose(`roles-prompt-pose-${sfx}`, lowerOnly.id);
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'boys', slug: `roles-prompt-gt-${sfx}`, label: 'Prompt only' })
      .returning();
    if (!garmentType) throw new Error('garment type not created');
    await app.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: p.id,
      subcategoryId: garmentType.id,
      promptGarmentPhase: 'x',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/models/poses?gender=boys&garmentTypeId=${garmentType.id}`,
      headers: { authorization: `Bearer ${await token(`roles-prompt-${sfx}@x.com`)}` },
    });
    const item = (res.json().items as { id: string; hasUpper: boolean; hasLower: boolean }[]).find(
      (i) => i.id === p.id,
    );
    expect(item).toMatchObject({ hasUpper: false, hasLower: true });
  });
});
