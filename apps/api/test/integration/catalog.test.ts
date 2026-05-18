import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startContainers, type Containers } from '../helpers/containers';
import { buildTestApp, type TestApp } from '../helpers/api';
import { schema } from '@aivastra/db';

describe('catalog', () => {
  let c: Containers; let app: TestApp;
  beforeAll(async () => { c = await startContainers(); app = await buildTestApp(c); }, 60000);
  afterAll(async () => { await app?.close(); await c?.stop(); });

  async function getToken() {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'catalog@x.com', password: 'password123' },
    });
    return res.json().accessToken;
  }

  async function seedCatalog() {
    const [type] = await app.db.insert(schema.catalogTypes).values({ slug: 'models', label: 'Models' }).returning();
    const [cat] = await app.db.insert(schema.catalogCategories).values({ typeId: type.id, slug: 'women', label: 'Women', sortOrder: 0 }).returning();
    await app.db.insert(schema.catalogItems).values({
      categoryId: cat.id, label: 'Model A', r2Key: 'k1', thumbnailKey: 't1', sortOrder: 0,
    });
    return type;
  }

  it('GET /v1/catalog/models returns category tree with items', async () => {
    const token = await getToken();
    await seedCatalog();
    const res = await app.inject({ method: 'GET', url: '/v1/catalog/models',
      headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tree[0].children.length).toBe(0);
    expect(res.json().tree[0].items.length).toBe(1);
  });
});
