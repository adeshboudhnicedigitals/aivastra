import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('admin config', () => {
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

  it('GET /admin/config default-fills uploadLimits, and PATCH persists a partial override', async () => {
    const getRes = await app.inject({
      method: 'GET',
      url: '/admin/config',
      headers: adminAuth,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().uploadLimits.merchantCatalogMaxBytes).toBe(20 * 1024 * 1024);
    expect(getRes.json().uploadLimits.bulkImportMaxBytes).toBe(2.5 * 1024 * 1024 * 1024);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/config',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ uploadLimits: { kioskUploadMaxBytes: 5 * 1024 * 1024 } }),
    });
    expect(patchRes.statusCode).toBe(200);

    const getRes2 = await app.inject({
      method: 'GET',
      url: '/admin/config',
      headers: adminAuth,
    });
    expect(getRes2.json().uploadLimits.kioskUploadMaxBytes).toBe(5 * 1024 * 1024);
    // Untouched fields still default-fill correctly alongside the override.
    expect(getRes2.json().uploadLimits.merchantCatalogMaxBytes).toBe(20 * 1024 * 1024);
  });
});
