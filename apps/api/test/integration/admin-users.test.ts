import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('admin-users', () => {
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
    return {
      token: res.json().accessToken,
      userId: JSON.parse(atob(res.json().accessToken.split('.')[1])).sub,
    };
  }

  it('returns 403 for non-admin accessing admin routes', async () => {
    const { token } = await registerUser('user@x.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to list users', async () => {
    const { token, userId } = await registerUser('admin2@x.com');
    await app.db.insert(schema.adminUsers).values({ userId, role: 'SUPER_ADMIN' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });
});
