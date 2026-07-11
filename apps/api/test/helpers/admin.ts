import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { TestApp } from './api.js';

let counter = 0;

/**
 * Registers + verifies a fresh user, promotes them to an admin_users row with the
 * given role (copying `users.passwordHash` into `admin_users.passwordHash`, exactly
 * as the real approval flow does in src/modules/admin/users.routes.ts around the
 * `/admin/admin-requests/:userId/approve` and direct-promote handlers), logs in via
 * the dedicated `/admin/auth/login` route, and returns the Authorization header the
 * real admin routes (guarded by `requireAdmin` in src/modules/admin/guard.ts, which
 * verifies the JWT with the `admin` audience) expect.
 *
 * NOTE: this intentionally does NOT use `/v1/auth/login` — that route explicitly
 * rejects active SUPER_ADMIN accounts (see modules/auth/routes.ts) and, more
 * importantly, mints a token without the `admin` JWT audience claim, which
 * `requireAdminUser`/`verifyAdminAccess` require. Only `/admin/auth/login`
 * (src/modules/admin/auth.routes.ts) mints an admin-audience token.
 */
export async function adminAuthHeader(
  app: TestApp,
  role: 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN' = 'SUPER_ADMIN',
): Promise<Record<string, string>> {
  const email = `admin-auth-${Date.now()}-${counter++}@x.com`;
  const password = 'password123';

  await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { displayName: 'Test Admin', email, password },
  });

  const [user] = await app.db
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (!user) throw new Error('adminAuthHeader: registered user not found');

  await app.db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, user.id));

  await app.db.insert(schema.adminUsers).values({
    userId: user.id,
    role,
    status: 'active',
    passwordHash: user.passwordHash,
  });

  const login = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { email, password },
  });
  const { accessToken } = login.json();
  if (!accessToken) throw new Error('adminAuthHeader: admin login did not return accessToken');

  return { authorization: `Bearer ${accessToken}` };
}
