import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let garmentTypeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  const [gt] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `kiosk-catalog-demo-gt-${randomUUID()}`,
      label: 'Kiosk Catalog Demo Garment Type',
      isActive: true,
    })
    .returning();
  if (!gt) throw new Error('failed to seed garment type');
  garmentTypeId = gt.id;
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function kioskToken(deviceId: string) {
  return signAccess(
    new TextEncoder().encode(app.env.JWT_SECRET),
    deviceId,
    { kind: 'access' },
    app.env.JWT_EXPIRY,
    'kiosk',
  );
}

async function createKioskDevice(merchantId: string) {
  const [device] = await app.db
    .insert(schema.kioskDevices)
    .values({ merchantId, label: 'Test Kiosk', status: 'active' })
    .returning();
  if (!device) throw new Error('failed to create test kiosk device');
  return device.id;
}

async function seedDemoSet(opts: { category?: string; name?: string } = {}) {
  const [set] = await app.db
    .insert(schema.demoCatalogSets)
    .values({ name: `Set ${randomUUID()}`, isActive: true })
    .returning();
  const [sub] = await app.db
    .insert(schema.demoCatalogSubcategories)
    .values({
      setId: set!.id,
      category: opts.category ?? 'women',
      name: opts.name ?? 'Demo Sarees',
      garmentSubcategoryId: garmentTypeId,
    })
    .returning();
  const [item] = await app.db
    .insert(schema.demoCatalogItems)
    .values({
      subcategoryId: sub!.id,
      label: 'Demo Product',
      sku: 'DEMO-SKU',
      actualPricePaise: 250000,
      offerPricePaise: 199000,
      r2Key: keys.demoCatalogItem(randomUUID()),
      thumbnailKey: keys.demoCatalogItemThumb(randomUUID()),
      isActive: true,
    })
    .returning();
  return { setId: set!.id, subcategoryId: sub!.id, itemId: item!.id };
}

async function assign(setId: string, merchantId: string) {
  await app.db.insert(schema.demoCatalogAssignments).values({ setId, merchantId });
}

function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

describe('kiosk catalog reads with demo data', () => {
  it('maps an assigned demo item using its subcategory gender/category', async () => {
    const merchant = await createTestMerchant(app);
    const deviceId = await createKioskDevice(merchant.merchantId);
    const token = await kioskToken(deviceId);
    const demo = await seedDemoSet({ category: 'men', name: 'Demo Kurtas' });
    await assign(demo.setId, merchant.merchantId);

    const res = await get('/v1/kiosk/catalog', token);
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === demo.itemId);
    expect(item).toMatchObject({
      label: 'Demo Product',
      sku: 'DEMO-SKU',
      gender: 'men',
      category: 'Demo Kurtas',
    });
    expect(item.imageUrl).toBeTruthy();
    expect(item.thumbnailUrl).toBeTruthy();
  });

  it('hides an unassigned demo set', async () => {
    const merchant = await createTestMerchant(app);
    const deviceId = await createKioskDevice(merchant.merchantId);
    const token = await kioskToken(deviceId);
    const demo = await seedDemoSet();

    const res = await get('/v1/kiosk/catalog', token);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { id: string }) => i.id)).not.toContain(demo.itemId);
  });

  it('lists the merchant own item and the assigned demo item together, unconflated', async () => {
    const merchant = await createTestMerchant(app);
    const deviceId = await createKioskDevice(merchant.merchantId);
    const token = await kioskToken(deviceId);

    const [ownSub] = await app.db
      .insert(schema.merchantCatalogSubcategories)
      .values({
        merchantId: merchant.merchantId,
        category: 'women',
        name: 'My Sarees',
        garmentSubcategoryId: garmentTypeId,
      })
      .returning();
    const [ownItem] = await app.db
      .insert(schema.merchantCatalogItems)
      .values({
        merchantId: merchant.merchantId,
        subcategoryId: ownSub!.id,
        label: 'My Product',
        actualPricePaise: 100,
        offerPricePaise: 100,
        r2Key: keys.merchantCatalogItem(merchant.merchantId, randomUUID()),
        thumbnailKey: keys.merchantCatalogItemThumb(merchant.merchantId, randomUUID()),
      })
      .returning();

    const demo = await seedDemoSet({ category: 'men', name: 'Demo Kurtas' });
    await assign(demo.setId, merchant.merchantId);

    const items = (await get('/v1/kiosk/catalog', token)).json().items;
    const own = items.find((i: { id: string }) => i.id === ownItem!.id);
    const demoItem = items.find((i: { id: string }) => i.id === demo.itemId);

    expect(own).toMatchObject({ label: 'My Product', gender: 'women', category: 'My Sarees' });
    expect(demoItem).toMatchObject({
      label: 'Demo Product',
      gender: 'men',
      category: 'Demo Kurtas',
    });
  });
});
