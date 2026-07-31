import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('admin app-video config + public read', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  afterEach(async () => {
    await app.redis.del(CONFIG_KEY);
  });

  it('GET /v1/config/app-video returns null before anything is uploaded', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config/app-video' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ videoUrl: null });
  });

  it('presign -> confirm makes the video visible on both admin GET and the public endpoint', async () => {
    const presignRes = await app.inject({
      method: 'POST',
      url: '/admin/config/app-video/presign',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ contentType: 'video/mp4' }),
    });
    expect(presignRes.statusCode).toBe(200);
    const presign = presignRes.json();
    expect(presign.uploadUrl).toBeTruthy();
    expect(presign.key).toBe('config/app-video.mp4');

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/admin/config/app-video/confirm',
      headers: adminAuth,
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = confirmRes.json();
    expect(confirmed.videoUrl).toContain('config/app-video.mp4');
    expect(confirmed.videoUrl).toContain('?v=');
    expect(confirmed.updatedAt).toBeTruthy();

    const adminGetRes = await app.inject({
      method: 'GET',
      url: '/admin/config/app-video',
      headers: adminAuth,
    });
    expect(adminGetRes.statusCode).toBe(200);
    expect(adminGetRes.json().videoUrl).toBe(confirmed.videoUrl);

    const publicRes = await app.inject({ method: 'GET', url: '/v1/config/app-video' });
    expect(publicRes.statusCode).toBe(200);
    expect(publicRes.json().videoUrl).toBe(confirmed.videoUrl);
  });

  it('re-uploading changes the cache-busting query param without changing the key', async () => {
    const firstConfirm = await app.inject({
      method: 'POST',
      url: '/admin/config/app-video/confirm',
      headers: adminAuth,
    });
    const firstUrl = firstConfirm.json().videoUrl as string;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const secondConfirm = await app.inject({
      method: 'POST',
      url: '/admin/config/app-video/confirm',
      headers: adminAuth,
    });
    const secondUrl = secondConfirm.json().videoUrl as string;

    expect(secondUrl).not.toBe(firstUrl);
    expect(secondUrl.split('?')[0]).toBe(firstUrl.split('?')[0]);
  });

  it('rejects non-mp4 content type on presign', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/config/app-video/presign',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ contentType: 'video/webm' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated access to admin app-video routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/config/app-video' });
    expect(res.statusCode).toBe(401);
  });
});
