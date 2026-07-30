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
