import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

function parseCookie(header: string | string[] | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const cookies = Array.isArray(header) ? header : [header];
  for (const c of cookies) {
    const m = c.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return undefined;
}

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

  async function registerAndLogin(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    const accessToken = (login.json() as any).accessToken;
    const refreshPlain = parseCookie(login.headers['set-cookie'], 'refresh');
    return { accessToken, refreshPlain };
  }

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

  it('concurrent refresh: one rotation, others reissue, all 200', async () => {
    const { refreshPlain } = await registerAndLogin('concurrent@x.com');
    expect(refreshPlain).toBeTruthy();

    const reqs = Array.from({ length: 5 }, () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        headers: { Cookie: `refresh=${refreshPlain}` },
      }),
    );
    const responses = await Promise.all(reqs);

    const rotated = responses.filter((r) => r.statusCode === 200 && r.headers['set-cookie']);
    const reissued = responses.filter((r) => r.statusCode === 200 && !r.headers['set-cookie']);
    const failed = responses.filter((r) => r.statusCode !== 200);

    expect(rotated.length).toBe(1);
    expect(reissued.length).toBe(4);
    expect(failed.length).toBe(0);
  });

  it('replay outside grace: stale token returns 401, family not revoked', async () => {
    const { refreshPlain } = await registerAndLogin('replay@x.com');
    expect(refreshPlain).toBeTruthy();

    // First refresh rotates G1 -> G2
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain}` },
    });
    expect(first.statusCode).toBe(200);

    // Wait longer than grace window
    await new Promise((r) => setTimeout(r, 3_500));

    // Reuse G1
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain}` },
    });
    expect(replay.statusCode).toBe(401);

    // G2 should still be valid (family NOT revoked)
    const refreshPlain2 = parseCookie(first.headers['set-cookie'], 'refresh');
    expect(refreshPlain2).toBeTruthy();
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain2}` },
    });
    expect(second.statusCode).toBe(200);
  });

  it('logout revokes entire family', async () => {
    const { accessToken, refreshPlain } = await registerAndLogin('logout@x.com');
    expect(refreshPlain).toBeTruthy();

    // Rotate to G2
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain}` },
    });
    expect(rotated.statusCode).toBe(200);
    const refreshPlain2 = parseCookie(rotated.headers['set-cookie'], 'refresh');

    // Logout with G2
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: {
        Cookie: `refresh=${refreshPlain2}`,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(logout.statusCode).toBe(200);

    // G2 refresh should now fail
    const after = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain2}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('grace window reissue: immediate reuse of just-used token succeeds', async () => {
    const { refreshPlain } = await registerAndLogin('grace@x.com');
    expect(refreshPlain).toBeTruthy();

    // First refresh rotates G1 -> G2.
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain}` },
    });
    expect(first.statusCode).toBe(200);

    // Immediate reuse of G1 within grace window should succeed via successor lookup.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { Cookie: `refresh=${refreshPlain}` },
    });
    expect(second.statusCode).toBe(200);
  });
});
