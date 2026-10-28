import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectCatalogItems } from '../../src/modules/catalog/items';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// The studio drops items in an inactive or missing category (its "Other" node);
// the bot has no tree to drop them from, so it asks selectCatalogItems to.
describe('selectCatalogItems categorizedOnly', () => {
  let c: Containers;
  let app: TestApp;
  // A gender slug no other file seeds, so shared-Postgres rows never leak in.
  const gender = `cat-only-${Date.now()}`;
  const labels: Record<string, string> = {};

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const [type] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: `shoe-cat-only-${Date.now()}`, label: 'Shoe' })
      .returning();
    const [on] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: type.id, slug: `on-${gender}`, label: 'On', isActive: true })
      .returning();
    const [off] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: type.id, slug: `off-${gender}`, label: 'Off', isActive: false })
      .returning();
    const item = (label: string, categoryId: number | null, isActive = true) =>
      app.db
        .insert(schema.catalogItems)
        .values({
          type: 'shoe',
          genderSlug: gender,
          label,
          r2Key: `${label}.jpg`,
          thumbnailKey: `${label}-t.jpg`,
          categoryId,
          isActive,
        })
        .returning()
        .then(([r]) => {
          labels[r.id] = label;
        });
    await item('in-active-category', on.id);
    await item('in-inactive-category', off.id);
    await item('no-category', null);
    await item('item-off-in-active-category', on.id, false);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const names = async (categorizedOnly?: boolean) =>
    (await selectCatalogItems(app, { type: 'shoe', gender, categorizedOnly }))
      .map((i) => labels[i.id])
      .sort();

  it('keeps only active items in an active category when asked', async () => {
    expect(await names(true)).toEqual(['in-active-category']);
  });

  it('leaves the studio route unfiltered by default', async () => {
    expect(await names()).toEqual(['in-active-category', 'in-inactive-category', 'no-category']);
  });
});
