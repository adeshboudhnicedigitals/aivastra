import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
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

  it('returns 403 for non-admin accessing admin routes', async () => {
    const { token } = await createVerifiedUserToken(app, 'user@x.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to list users', async () => {
    const { token, userId } = await createVerifiedUserToken(app, 'admin2@x.com');
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
