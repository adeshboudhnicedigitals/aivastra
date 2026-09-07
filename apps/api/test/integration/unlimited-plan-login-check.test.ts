import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('POST /v1/unlimited-plan/login-check', () => {
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

  async function registerUser(email: string) {
    const remoteAddress = `127.0.0.${nextTestClient++}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Login Check User', email, password: 'password123' },
    });
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress,
      payload: { email, password: 'password123' },
    });
    return { token: loginRes.json().accessToken as string, userId: user.id as string };
  }

  it('returns show:true for a user inside the 7-day window, over real HTTP with a real auth token', async () => {
    const { token, userId } = await registerUser('login-check-seven@x.com');
    await app.db.insert(schema.unlimitedPlans).values({
      userId,
      startAt: new Date(Date.now() - 23 * DAY_MS),
      endAt: new Date(Date.now() + 5 * DAY_MS),
      grantedBy: userId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/login-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ show: true, stage: 'seven_day' });
  });

  it('returns show:true and stage expired for a lapsed plan', async () => {
    const { token, userId } = await registerUser('login-check-expired@x.com');
    await app.db.insert(schema.unlimitedPlans).values({
      userId,
      startAt: new Date(Date.now() - 33 * DAY_MS),
      endAt: new Date(Date.now() - 3 * DAY_MS),
      grantedBy: userId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/login-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ show: true, stage: 'expired' });
  });

  it('returns show:false for a user with no unlimited plan', async () => {
    const { token } = await registerUser('login-check-none@x.com');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/login-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ show: false, stage: null });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/unlimited-plan/login-check' });
    expect(res.statusCode).toBe(401);
  });

  it('re-sends/returns show:true on a second call for the same user — no throttling yet, by design', async () => {
    const { token, userId } = await registerUser('login-check-repeat@x.com');
    await app.db.insert(schema.unlimitedPlans).values({
      userId,
      startAt: new Date(Date.now() - 25 * DAY_MS),
      endAt: new Date(Date.now() + 2 * DAY_MS),
      grantedBy: userId,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/login-check',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/login-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.json()).toMatchObject({ show: true, stage: 'three_day' });
    expect(second.json()).toMatchObject({ show: true, stage: 'three_day' });
  });
});
