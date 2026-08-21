import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  });
});
