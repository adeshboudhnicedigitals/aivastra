import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin garment-type <-> catalogue-template mapping', () => {
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
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
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

  it('PATCH mapped:true inserts a mapping row, mapped:false removes it', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
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
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
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
});
