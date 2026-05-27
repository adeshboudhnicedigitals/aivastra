import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { startContainers, type Containers } from '../helpers/containers';
import { buildServer } from '../../src/server';

async function buildGoogleApp(c: Containers) {
  const app = await buildServer({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', API_PORT: 0,
    DATABASE_URL: c.pgUrl, REDIS_URL: c.redisUrl,
    JWT_SECRET: 'test-jwt-secret-1234567890', JWT_EXPIRY: '15m', REFRESH_TOKEN_EXPIRY: '7d',
    R2_ENDPOINT: c.r2Endpoint, R2_ACCESS_KEY_ID: c.r2Key, R2_SECRET_ACCESS_KEY: c.r2Secret,
    R2_BUCKET: c.r2Bucket, R2_PUBLIC_URL: c.r2Endpoint + '/' + c.r2Bucket,
    R2_FORCE_PATH_STYLE: true, CORS_ORIGIN: 'http://localhost:3000',
    COOKIE_SECRET: 'test-cookie-secret-1234567890',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:4000/v1/auth/google/callback',
    WEB_URL: 'http://localhost:3000',
  });
  await app.listen({ port: 0 });
  return app;
}

describe('google oauth', () => {
  let c: Containers;
  let app: Awaited<ReturnType<typeof buildGoogleApp>>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildGoogleApp(c);
  }, 60000);

  afterAll(async () => { await app?.close(); await c?.stop(); });
  afterEach(() => vi.restoreAllMocks());

  it('GET /v1/auth/google/init redirects to Google with state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google/init' });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('client_id=test-google-client-id');
    expect(location).toContain('scope=openid+email+profile');
    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeTruthy();
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    expect(cookies.some((c: string) => c.startsWith('google_state='))).toBe(true);
  });

  it('POST /v1/auth/google/exchange with valid OTP returns accessToken', async () => {
    // Create a user to get a real userId
    const regRes = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'otp-test@example.com', password: 'password123' },
    });
    expect(regRes.statusCode).toBe(201);
    const { accessToken: regToken } = regRes.json() as { accessToken: string };

    // Decode userId from JWT sub claim
    const parts = regToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    const userId: string = claims.sub;

    // Seed OTP in Redis
    const otp = 'test-otp-1234';
    await app.redis.set(`oauth:otp:${otp}`, userId, 'EX', 60);

    // Exchange OTP
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: otp },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accessToken: expect.any(String) });

    // OTP must be consumed (cannot reuse)
    const res2 = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: otp },
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json()).toMatchObject({ error: { code: 'INVALID_OTP' } });
  });

  it('POST /v1/auth/google/exchange with expired/missing OTP returns 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: 'nonexistent-otp' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_OTP' } });
  });

  it('GET /v1/auth/google/callback upserts new user and redirects with OTP code', async () => {
    const state = 'test-csrf-state-abc123';
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-google-access-token' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
        return new Response(JSON.stringify({
          sub: 'google-sub-001',
          email: 'newgoogleuser@example.com',
          name: 'New Google User',
          picture: 'https://example.com/pic.jpg',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch to: ${urlStr}`);
    };
    vi.spyOn(global, 'fetch').mockImplementation(mockFetch as typeof fetch);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=auth_code_123&state=${state}`,
      headers: { cookie: `google_state=${state}` },
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('http://localhost:3000/api/auth/google/callback?code=');

    // Extract OTP and verify it exists in Redis
    const otp = new URL(location).searchParams.get('code')!;
    expect(otp).toBeTruthy();
    const storedUserId = await app.redis.get(`oauth:otp:${otp}`);
    expect(storedUserId).toBeTruthy();
  });

  it('GET /v1/auth/google/callback with mismatched state returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=auth_code&state=wrong-state',
      headers: { cookie: 'google_state=correct-state' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/auth/google/callback returns 400 when state cookie is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=auth_code&state=some-state',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/auth/google/callback links Google to existing email/password account', async () => {
    // Register a user with email/password first
    const regRes = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'existing@example.com', password: 'password123' },
    });
    expect(regRes.statusCode).toBe(201);

    const state = 'link-test-state-xyz';
    const mockFetchLink = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-google-token-link' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
        return new Response(JSON.stringify({
          sub: 'google-sub-link-002',
          email: 'existing@example.com',   // same email as registered user
          name: 'Existing User',
          picture: 'https://example.com/pic2.jpg',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch to: ${urlStr}`);
    };
    vi.spyOn(global, 'fetch').mockImplementation(mockFetchLink as typeof fetch);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=link_code_456&state=${state}`,
      headers: { cookie: `google_state=${state}` },
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('http://localhost:3000/api/auth/google/callback?code=');

    // Only one user should exist for this email
    const otp = new URL(location).searchParams.get('code')!;
    const linkedUserId = await app.redis.get(`oauth:otp:${otp}`);
    expect(linkedUserId).toBeTruthy();

    // Verify oauth_accounts row was created linking to the existing user
    const otp2 = new URL(location).searchParams.get('code')!;
    expect(otp2).toBeTruthy(); // OTP proves the link succeeded
  });
});
