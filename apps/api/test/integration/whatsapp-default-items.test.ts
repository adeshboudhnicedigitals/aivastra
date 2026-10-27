import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// A type's default lower/shoe is a plain id on the type. The studio would not
// show one whose item is off or whose category is off, so the bot must not draw
// it for every run of the type either.
describe('whatsapp default lower and shoe', () => {
  let c: Containers;
  let app: TestApp;
  let types: { good: string; shoeCategoryOff: string; lowerItemOff: string };
  let goodIds: { lower: string; shoe: string };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { WEB_URL: 'http://localhost:3000' });
    const sfx = `${Date.now()}`;
    const [catType] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: `def-items-${sfx}`, label: 'Items' })
      .returning();
    const category = async (slug: string, isActive: boolean) =>
      (
        await app.db
          .insert(schema.catalogCategories)
          .values({ typeId: catType.id, slug: `${slug}-${sfx}`, label: slug, isActive })
          .returning()
      )[0];
    const on = await category('on', true);
    const off = await category('off', false);
    const item = async (type: 'lower' | 'shoe', categoryId: number, isActive = true) =>
      (
        await app.db
          .insert(schema.catalogItems)
          .values({
            type,
            genderSlug: 'women',
            label: `${type}-${categoryId}-${isActive}`,
            r2Key: `${type}${categoryId}${isActive}${sfx}.jpg`,
            thumbnailKey: `${type}${categoryId}${isActive}${sfx}-t.jpg`,
            categoryId,
            isActive,
          })
          .returning()
      )[0];
    const goodLower = await item('lower', on.id);
    const goodShoe = await item('shoe', on.id);
    const shoeInOffCategory = await item('shoe', off.id);
    const lowerOff = await item('lower', on.id, false);

    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `def-wf-${sfx}`,
        label: 'wf',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `DefPose${sfx}`,
        genderSlug: 'women',
        r2Key: `def-p${sfx}.jpg`,
        thumbnailKey: `def-p${sfx}-t.jpg`,
        workflowTemplateId: workflow.id,
      })
      .returning();
    const type = async (label: string, lower: string, shoe: string) => {
      const [t] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `def-${label}-${sfx}`,
          label,
          defaultLowerCatalogId: lower,
          defaultShoeCatalogId: shoe,
        })
        .returning();
      await app.db
        .insert(schema.poseGarmentConfigs)
        .values({ poseAssetId: pose.id, subcategoryId: t.id });
      return t.id;
    };
    types = {
      good: await type('good', goodLower.id, goodShoe.id),
      shoeCategoryOff: await type('shoecatoff', goodLower.id, shoeInOffCategory.id),
      lowerItemOff: await type('loweroff', lowerOff.id, goodShoe.id),
    };
    goodIds = { lower: goodLower.id, shoe: goodShoe.id };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('keeps defaults the studio would show and drops the rest', async () => {
    const offered = await createEngineDeps(app).listGarmentTypes('women');
    const by = (id: string) => offered.find((t) => t.id === id);
    expect(by(types.good)).toMatchObject({
      defaultLowerCatalogId: goodIds.lower,
      defaultShoeCatalogId: goodIds.shoe,
    });
    expect(by(types.shoeCategoryOff)).toMatchObject({
      defaultLowerCatalogId: goodIds.lower,
      defaultShoeCatalogId: null,
    });
    expect(by(types.lowerItemOff)).toMatchObject({
      defaultLowerCatalogId: null,
      defaultShoeCatalogId: goodIds.shoe,
    });
  });
});
