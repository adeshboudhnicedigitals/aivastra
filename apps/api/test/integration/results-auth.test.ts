import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('results auth unification', () => {
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

  it('allows active admin of any role to log into /results', async () => {
    const password = 'password123';
    const passwordHash = await hashPassword(password);

    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: 'support-admin@x.com',
        passwordHash,
        displayName: 'Support Admin',
        emailVerified: true,
      })
      .returning();

    await app.db.insert(schema.adminUsers).values({
      userId: user.id,
      role: 'SUPPORT',
      status: 'active',
      passwordHash,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/results/login',
      payload: { email: 'support-admin@x.com', password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.cookies.some((cookie) => cookie.name === 'results_access_token')).toBe(true);
  });

  it('rejects non-admin user from /results with 403', async () => {
    const password = 'password123';
    const passwordHash = await hashPassword(password);

    await app.db.insert(schema.users).values({
      email: 'regular-user@x.com',
      passwordHash,
      displayName: 'Regular User',
      emailVerified: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/results/login',
      payload: { email: 'regular-user@x.com', password },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('admin access required');
  });

  it('rejects previously active admin if status changes to rejected (live check verification)', async () => {
    const password = 'password123';
    const passwordHash = await hashPassword(password);

    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: 'flip-status-admin@x.com',
        passwordHash,
        displayName: 'Flip Admin',
        emailVerified: true,
      })
      .returning();

    await app.db.insert(schema.adminUsers).values({
      userId: user.id,
      role: 'ADMIN',
      status: 'active',
      passwordHash,
    });

    // First login succeeds while active
    const res1 = await app.inject({
      method: 'POST',
      url: '/results/login',
      payload: { email: 'flip-status-admin@x.com', password },
    });
    expect(res1.statusCode).toBe(200);

    // Flip status to rejected in DB
    await app.db
      .update(schema.adminUsers)
      .set({ status: 'rejected' })
      .where(eq(schema.adminUsers.userId, user.id));

    // Next login immediately fails with 403
    const res2 = await app.inject({
      method: 'POST',
      url: '/results/login',
      payload: { email: 'flip-status-admin@x.com', password },
    });
    expect(res2.statusCode).toBe(403);
    expect(res2.json().error.message).toBe('admin access required');
  });
});
