import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:image-compression';

describe('admin image compression config', () => {
  let c: Containers;
  let app: TestApp;
  let superAdminAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAdminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  afterEach(async () => {
    await app.redis.del(CONFIG_KEY);
  });

  it("GET default-fills every job source, preserving today's real behavior", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/image-compression',
      headers: superAdminAuth,
    });
    expect(res.statusCode).toBe(200);
    const cfg = res.json();
    // tryon/api_tryon/regenerate are the two hardcoded webp q90 paths today —
    // must default to enabled so shipping this doesn't silently change output.
    expect(cfg.tryon).toEqual({ enabled: true, level: 'q90' });
    expect(cfg.api_tryon).toEqual({ enabled: true, level: 'q90' });
    expect(cfg.regenerate).toEqual({ enabled: true, level: 'q90' });
    // Catalogue/saree paths are currently uncompressed PNG.
    expect(cfg.catalog).toEqual({ enabled: false, level: 'q90' });
    expect(cfg.merchant_catalog).toEqual({ enabled: false, level: 'q90' });
    expect(cfg.saree).toEqual({ enabled: false, level: 'q90' });
    // catalog_video (PixVerse lane) has no sharp image to compress.
    expect(cfg.catalog_video).toBeUndefined();
  });

  it('PATCH persists a per-source override, independent of other sources', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/image-compression',
      headers: { ...superAdminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        catalog: { enabled: true, level: 'lossless' },
        merchant_catalog: { enabled: false, level: 'q90' },
      }),
    });
    expect(patchRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/admin/image-compression',
      headers: superAdminAuth,
    });
    const cfg = getRes.json();
    expect(cfg.catalog).toEqual({ enabled: true, level: 'lossless' });
    // Untouched source in the same PATCH body still defaults correctly.
    expect(cfg.saree).toEqual({ enabled: false, level: 'q90' });
  });

  it('rejects a non-SUPER_ADMIN admin role', async () => {
    const adminAuth = await adminAuthHeader(app, 'ADMIN');

    const getRes = await app.inject({
      method: 'GET',
      url: '/admin/image-compression',
      headers: adminAuth,
    });
    expect(getRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/image-compression',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ catalog: { enabled: true, level: 'q90' } }),
    });
    expect(patchRes.statusCode).toBe(403);
  });
});
