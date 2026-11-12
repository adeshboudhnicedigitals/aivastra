import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestCatalogItem,
  createTestDevice,
  createTestGarmentType,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// CRM phase 3, slice 3a: size sets, variants, per-branch stock (spec §6.2).

let c: Containers;
let app: TestApp;
let admin: Record<string, string>;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  admin = await adminAuthHeader(app);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function setup() {
  const m = await createTestMerchant(app);
  const b1 = await createTestBranch(app, m.merchantId, { name: 'A Branch' });
  const b2 = await createTestBranch(app, m.merchantId, { name: 'B Branch' });
  const b3 = await createTestBranch(app, m.merchantId, { name: 'C Branch' });
  const staff1 = await createTestStaff(app, m.merchantId, b1.id);
  const device = await createTestDevice(app, m.merchantId, b1.id);
  const gt = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, gt.id);
  const [tops] = await app.db
    .select()
    .from(schema.sizeSets)
    .where(eq(schema.sizeSets.slug, 'tops-alpha'));
  const attach = await app.inject({
    method: 'PUT',
    url: `/admin/assets/garment-types/${gt.id}/size-set`,
    headers: admin,
    payload: { sizeSetId: tops!.id },
  });
  expect(attach.statusCode).toBe(200);
  return { m, b1, b2, b3, staff1, device, item, owner: await memberAuthHeader(app, m.userId) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const addVariant = (ctx: Ctx, body: Record<string, unknown>, auth = ctx.owner) =>
  app.inject({
    method: 'POST',
    url: `/v1/merchant/catalog/${ctx.item.id}/variants`,
    headers: auth,
    payload: body,
  });
const setStock = (
  ctx: Ctx,
  variantId: string,
  branchId: string,
  status: string,
  auth = ctx.owner,
) =>
  app.inject({
    method: 'PUT',
    url: `/v1/merchant/variants/${variantId}/stock/${branchId}`,
    headers: auth,
    payload: { status },
  });

describe('variants', () => {
  it('a size from the garment type set is standard; anything else is custom (server-derived)', async () => {
    const ctx = await setup();
    const m = await addVariant(ctx, { size: 'M', colour: 'Red', barcode: '8901234567890' });
    expect(m.statusCode).toBe(201);
    expect(m.json()).toMatchObject({ size: 'M', isCustom: false, colour: 'Red' });
    const custom = await addVariant(ctx, { size: '36B' });
    expect(custom.json().isCustom).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/merchant/catalog/${ctx.item.id}/variants`,
      headers: ctx.owner,
    });
    expect(list.json().sizeSet).toEqual({
      name: 'Tops (XS–XXXL)',
      sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    });
    expect(list.json().variants.map((v: { size: string }) => v.size)).toEqual(['M', '36B']);
  });

  it('refuses a duplicate size+colour and a barcode already used by the merchant', async () => {
    const ctx = await setup();
    expect((await addVariant(ctx, { size: 'L', barcode: '1111222233334' })).statusCode).toBe(201);
    expect((await addVariant(ctx, { size: 'L' })).statusCode).toBe(409);
    expect((await addVariant(ctx, { size: 'XL', barcode: '1111222233334' })).statusCode).toBe(409);
  });

  it("staff edit variants brand-wide, but never another merchant's item", async () => {
    const ctx = await setup();
    const other = await setup();
    expect((await addVariant(ctx, { size: 'S' }, ctx.staff1.auth)).statusCode).toBe(201);
    expect((await addVariant(other, { size: 'S' }, ctx.owner)).statusCode).toBe(404);
  });
});

describe('stock', () => {
  it('staff set their own branch only; the admin any branch; every change is audited', async () => {
    const ctx = await setup();
    const v = (await addVariant(ctx, { size: 'M' })).json();
    expect((await setStock(ctx, v.id, ctx.b1.id, 'out', ctx.staff1.auth)).statusCode).toBe(200);
    expect((await setStock(ctx, v.id, ctx.b2.id, 'in_stock', ctx.staff1.auth)).statusCode).toBe(
      403,
    );
    expect((await setStock(ctx, v.id, ctx.b2.id, 'in_stock')).statusCode).toBe(200);
    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'variant_stock.set'));
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('a row owned by a feed refuses manual edits', async () => {
    const ctx = await setup();
    const v = (await addVariant(ctx, { size: 'M' })).json();
    await setStock(ctx, v.id, ctx.b1.id, 'in_stock');
    await app.db
      .update(schema.variantBranchStock)
      .set({ source: 'pos', quantity: 4 })
      .where(
        and(
          eq(schema.variantBranchStock.variantId, v.id),
          eq(schema.variantBranchStock.branchId, ctx.b1.id),
        ),
      );
    const res = await setStock(ctx, v.id, ctx.b1.id, 'out');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STOCK_MANAGED_BY_FEED');
  });
});

describe('tablet sizes', () => {
  it("shows this branch's status, other branches that have it, and the buy-online link", async () => {
    const ctx = await setup();
    await app.db
      .update(schema.merchants)
      .set({ storeUrl: 'https://shop.example.com' })
      .where(eq(schema.merchants.id, ctx.m.merchantId));
    const m = (await addVariant(ctx, { size: 'M', barcode: '5550001112223' })).json();
    const l = (await addVariant(ctx, { size: 'L' })).json();
    await setStock(ctx, m.id, ctx.b1.id, 'out');
    await setStock(ctx, m.id, ctx.b2.id, 'low');
    await setStock(ctx, m.id, ctx.b3.id, 'out');

    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/catalog/${ctx.item.id}/variants`,
      headers: ctx.device.auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.buyOnlineUrl).toBe('https://shop.example.com');
    const vm = body.variants.find((v: { id: string }) => v.id === m.id);
    expect(vm).toMatchObject({ status: 'out', barcode: '5550001112223' });
    expect(vm.otherBranches).toEqual([{ branchId: ctx.b2.id, name: 'B Branch', status: 'low' }]);
    expect(body.variants.find((v: { id: string }) => v.id === l.id).status).toBe('unknown');
  });

  it("another merchant's item has no sizes for this tablet", async () => {
    const ctx = await setup();
    const other = await setup();
    await addVariant(other, { size: 'M' }, other.owner);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/catalog/${other.item.id}/variants`,
      headers: ctx.device.auth,
    });
    expect(res.json().variants).toEqual([]);
  });
});

describe('admin size sets', () => {
  it('creates a set and refuses a duplicate slug', async () => {
    const body = { slug: 'shoes-uk', name: 'Shoes (UK)', sizes: ['5', '6', '7', '8', '9', '10'] };
    expect(
      (await app.inject({ method: 'POST', url: '/admin/size-sets', headers: admin, payload: body }))
        .statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/admin/size-sets', headers: admin, payload: body }))
        .statusCode,
    ).toBe(409);
    const list = await app.inject({ method: 'GET', url: '/admin/size-sets', headers: admin });
    expect(list.json().items.map((s: { slug: string }) => s.slug)).toEqual(
      expect.arrayContaining(['tops-alpha', 'bottoms-waist', 'kids-age', 'free-size', 'shoes-uk']),
    );
  });
});
