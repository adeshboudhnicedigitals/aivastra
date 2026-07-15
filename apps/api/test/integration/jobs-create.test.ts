import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('jobs-create', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
  });

  async function registerUser(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'Jobs Create User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return {
      token: login.json().accessToken,
      userId: JSON.parse(atob(login.json().accessToken.split('.')[1])).sub,
    };
  }

  async function seedCatalog(suffix = '') {
    const [type] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: `models${suffix}`, label: 'Models' })
      .returning();
    const [cat] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: type.id, slug: `women${suffix}`, label: 'Women' })
      .returning();
    const [m] = await app.db
      .insert(schema.catalogItems)
      .values({ categoryId: cat.id, label: 'Model A', r2Key: 'k1', thumbnailKey: 't1' })
      .returning();
    const [p] = await app.db
      .insert(schema.catalogItems)
      .values({ categoryId: cat.id, label: 'Pose A', r2Key: 'k2', thumbnailKey: 't2' })
      .returning();
    const [b] = await app.db
      .insert(schema.catalogItems)
      .values({ categoryId: cat.id, label: 'Bg A', r2Key: 'k3', thumbnailKey: 't3' })
      .returning();
    const [l] = await app.db
      .insert(schema.catalogItems)
      .values({ categoryId: cat.id, label: 'Lower A', r2Key: 'k4', thumbnailKey: 't4' })
      .returning();
    return { m: m.id, p: p.id, b: b.id, l: l.id };
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  it('creates job: deducts credit, inserts inputs, XADDs to jobs:normal', async () => {
    const { token, userId } = await registerUser('job@x.com');
    await grantCredits(userId, 5);
    const { m, p, b, l } = await seedCatalog();
    const body = {
      inputs: {
        upperGarmentKey: 'inputs/x/garment.jpg',
        modelCatalogId: m,
        poseCatalogId: p,
        backgroundCatalogId: b,
        lowerCatalogId: l,
      },
      userHint: 'soft light',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [j] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(j.status).toBe('QUEUED');
    const [bal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal.balance).toBe(4);
    const len = await app.redis.xlen('jobs:normal');
    expect(len).toBeGreaterThanOrEqual(1);
  });

  it('lists only studio and saree catalogues, excluding virtual try-on outputs', async () => {
    const { token, userId } = await registerUser('catalogue-filter@x.com');
    const [studioCatalogueId, sareeCatalogueId, tryonCatalogueId] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];

    const insertedJobs = await app.db
      .insert(schema.jobs)
      .values([
        { userId, catalogueId: studioCatalogueId, status: 'COMPLETED', creditsCharged: 1 },
        { userId, catalogueId: sareeCatalogueId, status: 'COMPLETED', creditsCharged: 1 },
        { userId, catalogueId: tryonCatalogueId, status: 'COMPLETED', creditsCharged: 1 },
      ])
      .returning();

    await app.db.insert(schema.jobInputs).values([
      { jobId: insertedJobs[0]!.id, upperGarmentKey: 'inputs/studio/garment.jpg', params: {} },
      {
        jobId: insertedJobs[1]!.id,
        upperGarmentKey: 'inputs/saree/garment.jpg',
        params: { kind: 'saree' },
      },
      {
        jobId: insertedJobs[2]!.id,
        upperGarmentKey: 'outputs/source-job.jpg',
        params: { sourceJobId: randomUUID(), personKey: 'inputs/person.jpg' },
      },
    ]);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/catalogues',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const catalogueIds = (list.json() as Array<{ catalogueId: string }>).map((c) => c.catalogueId);
    expect(catalogueIds).toContain(studioCatalogueId);
    expect(catalogueIds).toContain(sareeCatalogueId);
    expect(catalogueIds).not.toContain(tryonCatalogueId);

    const tryonDetail = await app.inject({
      method: 'GET',
      url: `/v1/catalogues/${tryonCatalogueId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(tryonDetail.statusCode).toBe(404);
  });

  it('assets list excludes try-on jobs whose "garment" is really a prior job output', async () => {
    const { token, userId } = await registerUser('assets-filter@x.com');

    const insertedJobs = await app.db
      .insert(schema.jobs)
      .values([
        { userId, status: 'COMPLETED', creditsCharged: 1 },
        { userId, status: 'COMPLETED', creditsCharged: 1 },
      ])
      .returning();

    await app.db.insert(schema.jobInputs).values([
      {
        jobId: insertedJobs[0]!.id,
        upperGarmentKey: 'inputs/real-upload/garment.jpg',
        params: {},
      },
      {
        // Try-on jobs set upperGarmentKey = keys.output(sourceJobId) — a
        // generated result, not an uploaded product photo.
        jobId: insertedJobs[1]!.id,
        upperGarmentKey: 'outputs/some-source-job/result.png',
        params: { sourceJobId: randomUUID(), personKey: 'inputs/person.jpg' },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const keys = (res.json() as Array<{ r2Key: string }>).map((a) => a.r2Key);
    expect(keys).toContain('inputs/real-upload/garment.jpg');
    expect(keys).not.toContain('outputs/some-source-job/result.png');
  });

  it('assets list sorts two or more real uploads by recency without crashing', async () => {
    const { token, userId } = await registerUser('assets-sort@x.com');

    const insertedJobs = await app.db
      .insert(schema.jobs)
      .values([
        { userId, status: 'COMPLETED', creditsCharged: 1 },
        { userId, status: 'COMPLETED', creditsCharged: 1 },
      ])
      .returning();

    await app.db.insert(schema.jobInputs).values([
      { jobId: insertedJobs[0]!.id, upperGarmentKey: 'inputs/older/garment.jpg', params: {} },
      { jobId: insertedJobs[1]!.id, upperGarmentKey: 'inputs/newer/garment.jpg', params: {} },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const keys = (res.json() as Array<{ r2Key: string }>).map((a) => a.r2Key);
    expect(keys).toContain('inputs/older/garment.jpg');
    expect(keys).toContain('inputs/newer/garment.jpg');
  });

  it('returns 402 when balance is 0', async () => {
    const { token, userId } = await registerUser('job2@x.com');
    await grantCredits(userId, 0);
    const { m, p, b, l } = await seedCatalog('-2');
    const body = {
      inputs: {
        upperGarmentKey: 'inputs/x/garment.jpg',
        modelCatalogId: m,
        poseCatalogId: p,
        backgroundCatalogId: b,
        lowerCatalogId: l,
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
  });
});
