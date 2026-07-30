import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('GET /admin/workers/job-types', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    authHeader = await adminAuthHeader(app, 'SUPPORT');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('returns all 5 worker pools', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/workers/job-types',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sort()).toEqual(
      ['catalogue', 'merchant', 'saree', 'shopify', 'tryon'].sort(),
    );
  });
});

describe('GET /admin/jobs/sources', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    authHeader = await adminAuthHeader(app, 'SUPPORT');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('returns all 13 job sources', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/jobs/sources',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as string[];
    expect(body).toHaveLength(13);
    expect(body.sort()).toEqual(
      [
        'catalog',
        'tryon',
        'catalog_video',
        'saree',
        'saree_mannequin',
        'shopify',
        'merchant_catalog',
        'merchant_catalog_saree_mannequin',
        'merchant_tryon',
        'kiosk',
        'api_tryon',
        'api_saree_mannequin',
        'api_catalog',
      ].sort(),
    );
  });
});
