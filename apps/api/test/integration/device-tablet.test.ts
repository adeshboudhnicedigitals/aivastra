import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestCatalogItem,
  createTestDevice,
  createTestGarmentType,
  createTestMerchant,
  memberAuthHeader,
  stageCustomerPhoto,
} from '../helpers/merchant';

// Device-mode plan Task 1: the device twins of the owner reads the Merchant Android app uses.
// Each must return exactly what the owner route returns for the same merchant, and nothing
// of another merchant's.

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function setup() {
  const m = await createTestMerchant(app, { demoData: false });
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const garmentType = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
  return { m, branch, device, item, owner: await memberAuthHeader(app, m.userId) };
}

const get = (headers: Record<string, string>, url: string) =>
  app.inject({ method: 'GET', url, headers });

describe('device catalog reads', () => {
  it('lists the same items and subcategories the owner route lists', async () => {
    const ctx = await setup();
    const other = await setup();
    for (const path of [
      '/v1/catalog?includeDemo=false',
      '/v1/catalog/subcategories?includeDemo=false',
    ]) {
      const asDevice = await get(ctx.device.auth, `/v1/device${path.slice(3)}`);
      const asOwner = await get(ctx.owner, `/v1/merchant${path.slice(3)}`);
      expect(asDevice.statusCode, path).toBe(200);
      expect(asDevice.json(), path).toEqual(asOwner.json());
    }
    const ids = (await get(ctx.device.auth, '/v1/device/catalog?includeDemo=false'))
      .json()
      .items.map((i: { id: string }) => i.id);
    expect(ids).toContain(ctx.item.id);
    expect(ids).not.toContain(other.item.id);
  });

  it('a deactivated device is refused', async () => {
    const ctx = await setup();
    await app.db
      .update(schema.merchantDevices)
      .set({ isActive: false })
      .where(eq(schema.merchantDevices.id, ctx.device.deviceId));
    expect((await get(ctx.device.auth, '/v1/device/catalog')).statusCode).toBe(401);
    expect((await get({}, '/v1/device/catalog')).statusCode).toBe(401);
  });
});

describe('device photo routes', () => {
  it("previews its own merchant's photo and refuses another merchant's key", async () => {
    const ctx = await setup();
    const other = await setup();
    const own = await stageCustomerPhoto(app, ctx.m.merchantId);
    const foreign = await stageCustomerPhoto(app, other.m.merchantId);
    const url = (k: string) => `/v1/device/tryon/photo-url?r2Key=${encodeURIComponent(k)}`;
    const ok = await get(ctx.device.auth, url(own));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().url).toEqual(expect.any(String));
    expect((await get(ctx.device.auth, url(foreign))).statusCode).toBe(403);
  });

  it("creates a phone-upload session and never reveals another merchant's", async () => {
    const ctx = await setup();
    const other = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/upload-sessions',
      headers: ctx.device.auth,
    });
    expect(created.statusCode).toBe(201);
    const { token, qrUrl } = created.json() as { token: string; qrUrl: string };
    expect(qrUrl).toContain(`/kiosk-upload/${token}`);

    const mine = await get(ctx.device.auth, `/v1/device/tryon/upload-sessions/${token}`);
    expect(mine.json()).toEqual({ status: 'pending', r2Key: null });
    expect(
      (await get(other.device.auth, `/v1/device/tryon/upload-sessions/${token}`)).statusCode,
    ).toBe(404);
  });
});

describe('device job status', () => {
  it('carries shareUrl beside resultUrl', async () => {
    const ctx = await setup();
    const s = await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: ctx.device.auth,
      payload: { mode: 'kiosk' },
    });
    const job = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: ctx.device.auth,
      payload: {
        sessionId: s.json().id,
        merchantCatalogItemId: ctx.item.id,
        customerPhotoKey: await stageCustomerPhoto(app, ctx.m.merchantId),
      },
    });
    expect(job.statusCode).toBe(201);
    const status = await get(ctx.device.auth, `/v1/device/tryon/jobs/${job.json().jobId}`);
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body).toHaveProperty('shareUrl');
    expect(body.shareUrl).toBe(body.resultUrl);
  });
});
