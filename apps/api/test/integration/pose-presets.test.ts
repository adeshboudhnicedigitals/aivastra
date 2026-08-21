import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('pose presets', () => {
  let c: Containers;
  let app: TestApp;
  let nextTestClient = 1;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // Each call registers+logs in a fresh user; /v1/auth/login is capped at
  // 5/min per IP (apps/api/src/modules/auth/routes.ts), and this suite logs in
  // more than 5 distinct users, so each call needs its own remoteAddress to
  // avoid colliding on the limiter bucket (same pattern as payments-tier.test.ts).
  async function getToken(email: string) {
    const remoteAddress = `127.0.0.${nextTestClient++}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Preset User', email, password: 'password123' },
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
    return { token: login.json().accessToken as string, userId: user.id };
  }

  async function makePose(active = true) {
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `pose-${Date.now()}-${Math.random()}`,
        genderSlug: 'women',
        r2Key: 'p.jpg',
        thumbnailKey: 'p-thumb.jpg',
        isActive: active,
      })
      .returning();
    return pose.id;
  }

  it('creates and lists a named preset', async () => {
    const { token } = await getToken('preset-crud@x.com');
    const poseId = await makePose();

    const create = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'My Look', poseIds: [poseId] },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().name).toBe('My Look');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().named).toHaveLength(1);
    expect(list.json().named[0].poseIds).toEqual([poseId]);
  });

  it('rejects an 11th named preset with PRESET_LIMIT_REACHED', async () => {
    const { token } = await getToken('preset-cap@x.com');
    for (let i = 0; i < 10; i++) {
      const poseId = await makePose();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pose-presets',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: `Look ${i}`, poseIds: [poseId] },
      });
      expect(res.statusCode).toBe(201);
    }
    const poseId = await makePose();
    const overflow = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Look 11', poseIds: [poseId] },
    });
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json().error.code).toBe('PRESET_LIMIT_REACHED');
  });

  it('rejects a duplicate name (case-insensitive) with PRESET_NAME_TAKEN', async () => {
    const { token } = await getToken('preset-dupe@x.com');
    const poseId = await makePose();
    await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Beach Day', poseIds: [poseId] },
    });
    const dupe = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'beach day', poseIds: [poseId] },
    });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error.code).toBe('PRESET_NAME_TAKEN');
  });

  it('filters out inactive poses on GET and 400s on create with an inactive pose', async () => {
    const { token } = await getToken('preset-inactive@x.com');
    const inactivePoseId = await makePose(false);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Stale', poseIds: [inactivePoseId] },
    });
    expect(create.statusCode).toBe(400);
    expect(create.json().error.code).toBe('INVALID_POSE_IDS');

    // A pose that was active at save time but is later deactivated must be
    // filtered out of the preset's poseIds on GET (activePoseIds in
    // routes.ts), not just rejected at create time.
    const poseId = await makePose();
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Goes Stale', poseIds: [poseId] },
    });
    expect(saved.statusCode).toBe(201);

    await app.db
      .update(schema.modelPoseAssets)
      .set({ isActive: false })
      .where(eq(schema.modelPoseAssets.id, poseId));

    const list = await app.inject({
      method: 'GET',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const staled = list.json().named.find((p: { name: string }) => p.name === 'Goes Stale');
    expect(staled.poseIds).toEqual([]);
  });

  it("cannot delete another user's preset", async () => {
    const a = await getToken('preset-owner-a@x.com');
    const b = await getToken('preset-owner-b@x.com');
    const poseId = await makePose();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/pose-presets',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { name: 'Owned By A', poseIds: [poseId] },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/pose-presets/${created.json().id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(del.statusCode).toBe(404);
    expect(del.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects deleting the last-used row', async () => {
    const { token, userId } = await getToken('preset-last-used-del@x.com');
    const poseId = await makePose();
    const [lastUsed] = await app.db
      .insert(schema.userPosePresets)
      .values({ userId, poseIds: [poseId], isLastUsed: true })
      .returning();
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/pose-presets/${lastUsed.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().error.code).toBe('VALIDATION');
  });

  describe('last-used auto-tracking', () => {
    let realHeadObject: typeof app.storage.headObject | undefined;
    beforeEach(() => {
      realHeadObject = app.storage.headObject?.bind(app.storage);
      app.storage.headObject = (async () => ({
        contentLength: 1024,
      })) as typeof app.storage.headObject;
    });
    afterEach(() => {
      if (realHeadObject) app.storage.headObject = realHeadObject;
    });

    async function seedFaceAndLook(suffix: string) {
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

    async function submitTryonJob(token: string, userId: string, suffix: string) {
      const { faceId, backgroundId, poseId } = await seedFaceAndLook(suffix);
      // INPUT_GARMENT_KEY (packages/types/src/jobs.ts) only accepts the exact
      // literal `inputs/<uuid>/garment.jpg` — no suffix — so both submissions
      // for a given user reuse the same key; the Redis ownership binding is
      // reset before each submit and isn't consumed by createJob, so reuse is safe.
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await app.redis.set(`upload:owner:${garmentKey}`, userId, 'EX', 3600);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/tryon',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
          aspectRatio: '1:1',
          resolution: '2K',
        },
      });
      return { res, poseId };
    }

    it('upserts the last-used preset after a successful tryon job, overwriting on resubmit', async () => {
      const { token, userId } = await getToken('preset-last-used-job@x.com');
      await app.db
        .insert(schema.userCredits)
        .values({ userId, balance: 100 })
        .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: 100 } });

      const first = await submitTryonJob(token, userId, 'a');
      expect(first.res.statusCode).toBe(201);

      const [lastUsedAfterFirst] = await app.db
        .select()
        .from(schema.userPosePresets)
        .where(
          and(
            eq(schema.userPosePresets.userId, userId),
            eq(schema.userPosePresets.isLastUsed, true),
          ),
        );
      expect(lastUsedAfterFirst).toBeDefined();
      expect(lastUsedAfterFirst.poseIds).toEqual([first.poseId]);

      const second = await submitTryonJob(token, userId, 'b');
      expect(second.res.statusCode).toBe(201);

      const rows = await app.db
        .select()
        .from(schema.userPosePresets)
        .where(
          and(
            eq(schema.userPosePresets.userId, userId),
            eq(schema.userPosePresets.isLastUsed, true),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].poseIds).toEqual([second.poseId]);
    });
  });
});
