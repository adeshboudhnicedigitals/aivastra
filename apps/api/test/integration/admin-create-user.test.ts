import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('admin create user', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
    authHeader = await adminAuthHeader(app, 'ADMIN');
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  it('rejects creating a user without an email — username-only walk-in accounts are no longer allowed', async () => {
    const username = `walkin${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: { username, password: 'password123', displayName: 'Walk-in Customer' },
    });
    expect(createRes.statusCode).toBe(400);
  });

  it('rejects creating a user without a username', async () => {
    const email = `nousername${Date.now()}@example.com`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: { password: 'password123', displayName: 'No Username', email },
    });
    expect(createRes.statusCode).toBe(400);
  });

  it('logging in with the username is case-insensitive', async () => {
    const username = `caseinsensitive${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: {
        username,
        password: 'password123',
        displayName: 'Case Test',
        email: `${username}@example.com`,
      },
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: username.toUpperCase(), password: 'password123' },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('rejects a duplicate username', async () => {
    const username = `dupe${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: {
        username,
        password: 'password123',
        displayName: 'First',
        email: `${username}.first@example.com`,
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: {
        username,
        password: 'password123',
        displayName: 'Second',
        email: `${username}.second@example.com`,
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects a username shaped like an email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: {
        username: 'not@allowed',
        password: 'password123',
        displayName: 'X',
        email: `notallowed${Date.now()}@example.com`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate email', async () => {
    const existingEmail = `existing${Date.now()}@example.com`;
    await app.db.insert(schema.users).values({ email: existingEmail, tier: 'free' });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: authHeader,
      payload: {
        username: `withemail${Date.now()}`,
        password: 'password123',
        displayName: 'Has Email',
        email: existingEmail,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });
});
