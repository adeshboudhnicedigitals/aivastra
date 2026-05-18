import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startContainers, type Containers } from '../helpers/containers';
import { buildTestApp, type TestApp } from '../helpers/api';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';

describe('e2e', () => {
  let c: Containers; let app: TestApp;
  beforeAll(async () => { c = await startContainers(); app = await buildTestApp(c); }, 60000);
  afterAll(async () => { await app?.close(); await c?.stop(); });

  it('full flow: register → grant via admin → presign upload → create job', async () => {
    // 1. register normal user
    const userRes = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'e2e@x.com', password: 'password123' },
    });
    expect(userRes.statusCode).toBe(201);
    const { accessToken: userToken } = userRes.json();
    const userId = JSON.parse(atob(userToken.split('.')[1])).sub;

    // 2. create admin and grant credits
    const adminRes = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'e2e-admin@x.com', password: 'password123' },
    });
    const adminId = JSON.parse(atob(adminRes.json().accessToken.split('.')[1])).sub;
    await app.db.insert(schema.adminUsers).values({ userId: adminId, role: 'SUPER_ADMIN' });
    const adminToken = adminRes.json().accessToken;

    // 3. admin grants 5 credits
    const grantRes = await app.inject({
      method: 'POST', url: '/admin/credits/grant',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { userId, amount: 5, reason: 'E2E test' },
    });
    expect(grantRes.statusCode).toBe(200);

    // 4. verify balance
    const balRes = await app.inject({
      method: 'GET', url: '/v1/credits',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(balRes.json().balance).toBe(5);

    // 5. presign upload
    const presignRes = await app.inject({
      method: 'POST', url: '/v1/uploads/presign',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(presignRes.statusCode).toBe(200);

    // 6. seed catalog
    const [type] = await app.db.insert(schema.catalogTypes).values({ slug: 'models-e2e', label: 'Models' }).returning();
    const [cat] = await app.db.insert(schema.catalogCategories).values({ typeId: type.id, slug: 'women-e2e', label: 'Women' }).returning();
    const [m] = await app.db.insert(schema.catalogItems).values({ categoryId: cat.id, label: 'Model A', r2Key: 'k1', thumbnailKey: 't1' }).returning();
    const [p] = await app.db.insert(schema.catalogItems).values({ categoryId: cat.id, label: 'Pose A', r2Key: 'k2', thumbnailKey: 't2' }).returning();
    const [b] = await app.db.insert(schema.catalogItems).values({ categoryId: cat.id, label: 'Bg A', r2Key: 'k3', thumbnailKey: 't3' }).returning();
    const [l] = await app.db.insert(schema.catalogItems).values({ categoryId: cat.id, label: 'Lower A', r2Key: 'k4', thumbnailKey: 't4' }).returning();

    // 7. create job
    const jobRes = await app.inject({
      method: 'POST', url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        inputs: { upperGarmentKey: 'inputs/x/garment.jpg', modelCatalogId: m.id, poseCatalogId: p.id, backgroundCatalogId: b.id, lowerCatalogId: l.id },
        userHint: 'soft light',
      },
    });
    expect(jobRes.statusCode).toBe(201);
    const { jobId } = jobRes.json();

    // 8. assert balance deducted
    const bal2 = await app.inject({
      method: 'GET', url: '/v1/credits',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(bal2.json().balance).toBe(4);

    // 9. assert job queued
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe('QUEUED');

    // 10. assert redis stream
    const len = await app.redis.xlen('jobs:normal');
    expect(len).toBeGreaterThanOrEqual(1);
  }, 30000);
});
