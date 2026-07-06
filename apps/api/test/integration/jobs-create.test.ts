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
