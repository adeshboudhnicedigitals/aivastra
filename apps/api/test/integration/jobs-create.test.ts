import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('jobs-create', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: typeof app.storage.headObject | undefined;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    realHeadObject = app.storage.headObject?.bind(app.storage);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
    // assertOwnsUploadKey (in createJob's verifyGarmentKey path) checks the
    // upload actually exists in storage — mock it out like jobs-create-looks.test.ts.
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  // This file's registerUser count has grown past the /v1/auth/login route's
  // 5-per-minute limit (fastify-rate-limit buckets by IP, shared across every
  // test in the file since they all run against one app instance) — a distinct
  // RFC 5737 TEST-NET-1 address per call keeps each registerUser in its own
  // bucket, same fix as contact.test.ts.
  let registerUserIpCounter = 0;
  async function registerUser(email: string) {
    const remoteAddress = `192.0.2.${++registerUserIpCounter}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
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
      remoteAddress,
      payload: { email, password: 'password123' },
    });
    return {
      token: login.json().accessToken,
      userId: JSON.parse(atob(login.json().accessToken.split('.')[1])).sub,
    };
  }

  // Admin-curated face/pose/background assets — the current input model for
  // createJob (see jobs-create-looks.test.ts). The old catalog_items-based
  // modelCatalogId/poseCatalogId/backgroundCatalogId/lowerCatalogId shape this
  // file used to seed and post predates that model and no longer matches either
  // CreateTryOnJobRequest's schema or catalog_items' NOT NULL `type` column.
  async function seedFaceAndLook(suffix = '') {
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Face${suffix}`,
        r2Key: `f${suffix}.jpg`,
        thumbnailKey: `f${suffix}.jpg`,
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: `Bg${suffix}`, r2Key: `b${suffix}.jpg`, thumbnailKey: `b${suffix}.jpg` })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label: `Pose${suffix}`, r2Key: `p${suffix}.jpg`, thumbnailKey: `p${suffix}.jpg` })
      .returning();
    return { faceId: face.id, backgroundId: background.id, poseId: pose.id };
  }

  async function seedCreditPlan(slug: string) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
  }

  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  it('creates job: deducts credit, inserts inputs, XADDs to jobs:normal', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('job@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook();
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const body = {
      inputs: {
        upperGarmentKey: garmentKey,
        faceId,
        looks: [{ poseId, backgroundId }],
      },
      aspectRatio: '1:1',
      resolution: '2K',
      userHint: 'soft light',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    const [j] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobIds[0]));
    expect(j.status).toBe('QUEUED');
    const [bal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal.balance).toBeLessThan(100);
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
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('job2@x.com');
    await grantCredits(userId, 0);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-2');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const body = {
      inputs: {
        upperGarmentKey: garmentKey,
        faceId,
        looks: [{ poseId, backgroundId }],
      },
      aspectRatio: '1:1',
      resolution: '2K',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
  });

  it('rejects a job requesting a disabled resolution tier', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('disabled-tier@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('dt');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    // HD is disabled by default (DEFAULT_RESOLUTION_CONFIG.HD.enabled = false) —
    // no config:system override needed to exercise this.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
        aspectRatio: '1:1',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(400);
    // Error envelope is { error: { code, message } } (see server.ts's
    // setErrorHandler AppError branch), not a top-level `code`.
    expect(res.json().error.code).toBe('BAD_RESOLUTION');
  });

  it("computes output dims from the requested tier's longEdgePx via the aspect ratio formula", async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('tier-dims@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('td');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    // 2:3 is portrait (h > w) — long edge (4096, 4K's default) lands on height.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
        aspectRatio: '2:3',
        resolution: '4K',
      },
    });
    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(inputs?.params).toMatchObject({
      outputWidth: 2731,
      outputHeight: 4096,
      resolution: '4K',
    });
  });

  it("clamps custom output dims to the SELECTED tier's longEdgePx, not a fixed global ceiling", async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('tier-clamp@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('tc');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const bodyFor = (resolution: 'HD' | '2K' | '4K') => ({
      inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
      aspectRatio: '1:1',
      resolution,
      params: { outputWidth: 4000, outputHeight: 4000 },
    });

    // 2K's default longEdgePx (2688) is below the requested 4000 — clamped down.
    const res2k = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: bodyFor('2K'),
    });
    expect(res2k.statusCode).toBe(201);
    const [inputs2k] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res2k.json().jobIds[0]));
    expect(inputs2k?.params).toMatchObject({ outputWidth: 2688, outputHeight: 2688 });

    // Same requested 4000x4000, but 4K's default longEdgePx (4096) is above it —
    // not clamped at all, proving the ceiling tracks the selected tier, not a
    // single global number.
    const res4k = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: bodyFor('4K'),
    });
    expect(res4k.statusCode).toBe(201);
    const [inputs4k] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res4k.json().jobIds[0]));
    expect(inputs4k?.params).toMatchObject({ outputWidth: 4000, outputHeight: 4000 });
  });
});
