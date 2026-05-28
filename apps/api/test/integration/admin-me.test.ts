import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /admin/me', () => {
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

  async function registerUser(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const { accessToken } = res.json();
    const userId = JSON.parse(atob(accessToken.split('.')[1])).sub as string;
    return { token: accessToken, userId };
  }

  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const { token } = await registerUser('plain@x.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns userId, email, and role for SUPER_ADMIN', async () => {
    const { token, userId } = await registerUser('admin@x.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'SUPER_ADMIN' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      userId: userId,
      email: 'admin@x.com',
      role: 'SUPER_ADMIN',
    });
  });

  it('returns 200 for MODERATOR role', async () => {
    const { token, userId } = await registerUser('mod@x.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'MODERATOR' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: userId, email: 'mod@x.com', role: 'MODERATOR' });
  });
});
