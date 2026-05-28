import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('auth', () => {
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

  it('registers a user and returns tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'a@b.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ accessToken: expect.any(String) });
  });

  it('rejects duplicate email with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'dup@x.com', password: 'password123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'dup@x.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with correct password, rejects wrong', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'login@x.com', password: 'password123' },
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'login@x.com', password: 'password123' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'login@x.com', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });
});
