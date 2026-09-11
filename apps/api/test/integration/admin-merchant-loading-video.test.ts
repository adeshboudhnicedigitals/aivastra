import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';
import { createTestMerchant } from '../helpers/merchant.js';

describe('admin merchant loading-video upload', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  it('presigns an upload URL keyed to the merchant', async () => {
    const { merchantId } = await createTestMerchant(app);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/merchants/${merchantId}/loading-video/presign`,
      headers: authHeader,
      payload: { contentType: 'video/mp4' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { uploadUrl: string; loadingVideoKey: string };
    expect(body.uploadUrl).toBeTruthy();
    expect(body.loadingVideoKey).toBe(`merchant-loading-video/${merchantId}/video.mp4`);
  });

  it('rejects non-mp4 content type on presign', async () => {
    const { merchantId } = await createTestMerchant(app);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/merchants/${merchantId}/loading-video/presign`,
      headers: authHeader,
      payload: { contentType: 'video/webm' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('re-signs the returned loadingVideoUrl on each read, even though loadingVideoKey stays fixed', async () => {
    const { merchantId, userId } = await createTestMerchant(app);

    const firstSet = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${merchantId}`,
      headers: authHeader,
      payload: { loadingVideoKey: `merchant-loading-video/${merchantId}/video.mp4` },
    });
    expect(firstSet.statusCode).toBe(200);

    const firstDetail = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}`,
      headers: authHeader,
    });
    const firstUrl = (firstDetail.json() as { merchant: { loadingVideoUrl: string } }).merchant
      .loadingVideoUrl;
    expect(firstUrl).toContain(`merchant-loading-video/${merchantId}/video.mp4`);

    // SigV4's X-Amz-Date has 1-second granularity, so two presigns within the same
    // second are byte-identical — cross a full second boundary to reliably re-sign.
    await new Promise((r) => setTimeout(r, 1100));
    const secondSet = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${merchantId}`,
      headers: authHeader,
      payload: { loadingVideoKey: `merchant-loading-video/${merchantId}/video.mp4` },
    });
    expect(secondSet.statusCode).toBe(200);

    const secondDetail = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}`,
      headers: authHeader,
    });
    const secondUrl = (secondDetail.json() as { merchant: { loadingVideoUrl: string } }).merchant
      .loadingVideoUrl;

    expect(secondUrl).not.toBe(firstUrl);
  });

  it('persists loadingVideoKey via the existing PATCH route, and null clears it', async () => {
    const { merchantId } = await createTestMerchant(app);

    const setRes = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${merchantId}`,
      headers: authHeader,
      payload: { loadingVideoKey: `merchant-loading-video/${merchantId}/video.mp4` },
    });
    expect(setRes.statusCode).toBe(200);

    const [afterSet] = await app.db
      .select({ loadingVideoKey: schema.merchants.loadingVideoKey })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId));
    expect(afterSet?.loadingVideoKey).toBe(`merchant-loading-video/${merchantId}/video.mp4`);

    const clearRes = await app.inject({
      method: 'PATCH',
      url: `/admin/merchants/${merchantId}`,
      headers: authHeader,
      payload: { loadingVideoKey: null },
    });
    expect(clearRes.statusCode).toBe(200);

    const [afterClear] = await app.db
      .select({ loadingVideoKey: schema.merchants.loadingVideoKey })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId));
    expect(afterClear?.loadingVideoKey).toBeNull();
  });
});
