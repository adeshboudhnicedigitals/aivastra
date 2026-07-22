import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from './helpers/admin.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestDevTryonCategory } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let adminHeaders: Record<string, string>;
let wfId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  adminHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
  ({ workflowTemplateId: wfId } = await createTestDevTryonCategory(app, { slug: 'seed-cat' }));
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('admin dev-api routes', () => {
  it('creates a dev tryon category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dev-api/tryon-categories',
      headers: adminHeaders,
      payload: { name: 'API Upper', slug: 'api-upper', workflowTemplateId: wfId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('api-upper');
  });

  it('rejects a duplicate slug with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dev-api/tryon-categories',
      headers: adminHeaders,
      payload: { name: 'Dup', slug: 'api-upper', workflowTemplateId: wfId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('patches isActive', async () => {
    const [row] = await app.db
      .select({ id: schema.devTryonCategories.id })
      .from(schema.devTryonCategories)
      .where(eq(schema.devTryonCategories.slug, 'api-upper'));
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/dev-api/tryon-categories/${row!.id}`,
      headers: adminHeaders,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().isActive).toBe(false);
  });

  it('404s patching an unknown category', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/dev-api/tryon-categories/00000000-0000-0000-0000-000000000000',
      headers: adminHeaders,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists dev tryon categories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dev-api/tryon-categories',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('api-upper');
  });

  it('upserts the saree config', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/dev-api/saree-config',
      headers: adminHeaders,
      payload: { workflowTemplateId: wfId, isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflowTemplateId).toBe(wfId);
  });

  it('reads back the saree config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dev-api/saree-config',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflowTemplateId).toBe(wfId);
  });

  it('deletes a dev tryon category', async () => {
    const { categoryId } = await createTestDevTryonCategory(app, { slug: 'to-delete' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/dev-api/tryon-categories/${categoryId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('404s without an admin token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dev-api/tryon-categories',
    });
    expect(res.statusCode).toBe(401);
  });
});
