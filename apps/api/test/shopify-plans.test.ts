import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from './helpers/admin.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

describe('admin shopify-plans', () => {
  let c: Containers;
  let app: TestApp;
  let auth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    auth = await adminAuthHeader(app);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('creates, lists, updates, soft-deletes a plan', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/shopify-plans',
      headers: auth,
      payload: { name: 'Trend', priceCents: 1999, includedTryons: 100, overageCents: 16 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const list = await app.inject({ method: 'GET', url: '/admin/shopify-plans', headers: auth });
    expect(list.json().plans).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify-plans/${id}`,
      headers: auth,
      payload: { includedTryons: 150 },
    });
    expect(patched.json().plan.includedTryons).toBe(150);

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify-plans/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);

    const listAfter = await app.inject({
      method: 'GET',
      url: '/admin/shopify-plans?activeOnly=true',
      headers: auth,
    });
    expect(listAfter.json().plans).toHaveLength(0);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/shopify-plans' });
    expect(res.statusCode).toBe(401);
  });
});
