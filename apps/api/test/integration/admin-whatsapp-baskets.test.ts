import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Admin WhatsApp page → Baskets tab. Membership lives on the garment type row,
// every write is audited in the same transaction, and a delete only deactivates.
describe('admin whatsapp baskets', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  let ids: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const rows = await app.db
      .insert(schema.garmentSubcategories)
      .values([
        { genderSlug: 'men', slug: 'wb-shirt', label: 'Shirt', sortOrder: 1 },
        { genderSlug: 'men', slug: 'wb-vest', label: 'Vest', sortOrder: 2 },
        { genderSlug: 'men', slug: 'wb-tank', label: 'Tank top', sortOrder: 3 },
        {
          genderSlug: 'men',
          slug: 'wb-set',
          label: 'Shirt & trouser',
          requiresLowerUpload: true,
        },
        { genderSlug: 'women', slug: 'wb-top', label: 'Top' },
      ])
      .returning({ id: schema.garmentSubcategories.id, slug: schema.garmentSubcategories.slug });
    ids = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/admin/whatsapp/baskets', headers, payload: body });

  const basketOf = async (id: string) =>
    (
      await app.db
        .select({ b: schema.garmentSubcategories.whatsappBasketId })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id))
    )[0]?.b ?? null;

  const audits = (resourceId: string) =>
    app.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.resourceType, 'whatsapp_basket'),
          eq(schema.auditLogs.resourceId, resourceId),
        ),
      );

  it('creates a basket, links its members and audits it', async () => {
    const res = await create({
      genderSlug: 'men',
      name: 'Men upper',
      memberIds: [ids['wb-shirt'], ids['wb-vest']],
      representativeSubcategoryId: ids['wb-shirt'],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ name: 'Men upper', representativeSubcategoryId: ids['wb-shirt'] });
    expect(body.memberIds.sort()).toEqual([ids['wb-shirt'], ids['wb-vest']].sort());
    expect(await basketOf(ids['wb-vest'])).toBe(body.id);
    expect((await audits(body.id)).map((a) => a.action)).toEqual(['whatsapp_baskets.create']);
  });

  it('lists the gender with each type’s basket and why a type is not offered', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/whatsapp/baskets?gender=men',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const { baskets, types } = res.json();
    expect(baskets.map((b: { name: string }) => b.name)).toContain('Men upper');
    const set = types.find((t: { id: string }) => t.id === ids['wb-set']);
    expect(set).toMatchObject({ ineligibleReason: 'lower_upload', basketId: null });
    expect(types.some((t: { id: string }) => t.id === ids['wb-top'])).toBe(false);
  });

  it('rejects a two-image member, another gender’s type and a representative outside the members', async () => {
    const twoImage = await create({
      genderSlug: 'men',
      name: 'Sets',
      memberIds: [ids['wb-set']],
    });
    expect(twoImage.statusCode).toBe(400);
    const otherGender = await create({
      genderSlug: 'men',
      name: 'Mixed',
      memberIds: [ids['wb-top']],
    });
    expect(otherGender.statusCode).toBe(400);
    const badRep = await create({
      genderSlug: 'men',
      name: 'Bad rep',
      memberIds: [ids['wb-tank']],
      representativeSubcategoryId: ids['wb-shirt'],
    });
    expect(badRep.statusCode).toBe(400);
    // Nothing was written by the rejected requests.
    expect(await basketOf(ids['wb-tank'])).toBeNull();
  });

  it('replacing members moves a type out of its old basket and drops a stale representative', async () => {
    const upper = (await create({ genderSlug: 'men', name: 'Upper 2', memberIds: [] })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/whatsapp/baskets/${upper.id}`,
      headers,
      payload: { memberIds: [ids['wb-vest'], ids['wb-tank']] },
    });
    expect(res.statusCode).toBe(200);
    expect(await basketOf(ids['wb-vest'])).toBe(upper.id);
    expect(await basketOf(ids['wb-tank'])).toBe(upper.id);

    // The first basket lost the vest; its representative (the shirt) stays a member.
    const first = (
      await app.db
        .select()
        .from(schema.whatsappBaskets)
        .where(eq(schema.whatsappBaskets.name, 'Men upper'))
    )[0];
    const shrink = await app.inject({
      method: 'PATCH',
      url: `/admin/whatsapp/baskets/${first?.id}`,
      headers,
      payload: { memberIds: [] },
    });
    expect(shrink.json()).toMatchObject({ memberIds: [], representativeSubcategoryId: null });
    expect(await basketOf(ids['wb-shirt'])).toBeNull();
  });

  it('delete only deactivates, keeps the members and is audited', async () => {
    const b = (
      await create({ genderSlug: 'men', name: 'To retire', memberIds: [ids['wb-shirt']] })
    ).json();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/whatsapp/baskets/${b.id}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.whatsappBaskets)
      .where(eq(schema.whatsappBaskets.id, b.id));
    expect(row?.isActive).toBe(false);
    expect(await basketOf(ids['wb-shirt'])).toBe(b.id);
    expect((await audits(b.id)).map((a) => a.action).sort()).toEqual([
      'whatsapp_baskets.create',
      'whatsapp_baskets.deactivate',
    ]);
  });

  it('needs an admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/whatsapp/baskets?gender=men' });
    expect(res.statusCode).toBe(401);
  });
});
