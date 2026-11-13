import { schema } from '@aivastra/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { jwtVerify } from 'jose';
import { decryptToken, encryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { signAccess } from '../auth/service.js';

// Admin second factor (option B, decided 2026-11-12): roles that can see accounts or mint
// credits must use TOTP once enforcement is on; anyone who has enrolled is always challenged.

export const MFA_AUDIENCE = 'admin-mfa';
export const MFA_TOKEN_TTL = '5m';
const GATED_PERMISSIONS = ['accounts.read', 'credits.grant'];
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;

export type MfaGate = { kind: 'none' } | { kind: 'verify' } | { kind: 'enroll' };

export function mfaKey(app: FastifyInstance): string {
  const k = app.env.ADMIN_MFA_KEY;
  // Fail closed: a deployment that turns MFA on without a key must not quietly skip it.
  if (!k) throw new AppError('MFA_NOT_CONFIGURED', 503, 'two-factor is not configured');
  return k;
}

/** What this login must do next, after the password has been verified. */
export async function mfaGate(app: FastifyInstance, userId: string): Promise<MfaGate> {
  const [admin] = await app.db
    .select({ role: schema.adminUsers.role, enabledAt: schema.adminUsers.totpEnabledAt })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.userId, userId));
  if (!admin) return { kind: 'none' };
  if (admin.enabledAt) return { kind: 'verify' };
  if (app.env.ADMIN_MFA_ENFORCE !== true) return { kind: 'none' };
  const gated = await app.db
    .select({ id: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(
      and(
        inArray(schema.permissions.key, GATED_PERMISSIONS),
        eq(schema.rolePermissions.role, admin.role),
      ),
    );
  return gated.length > 0 ? { kind: 'enroll' } : { kind: 'none' };
}

export async function signMfaToken(
  app: FastifyInstance,
  userId: string,
  step: 'verify' | 'enroll',
): Promise<string> {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  return signAccess(secret, userId, { kind: 'mfa', step }, MFA_TOKEN_TTL, MFA_AUDIENCE);
}

/** The token proves the password step. It is not an access token and no route accepts it as one. */
export async function readMfaToken(
  app: FastifyInstance,
  token: string,
  step: 'verify' | 'enroll',
): Promise<string> {
  try {
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      audience: MFA_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (payload.kind !== 'mfa' || payload.step !== step) throw new Error('wrong step');
    return String(payload.sub);
  } catch {
    throw new AppError('INVALID_MFA_TOKEN', 401, 'sign in again');
  }
}

const failKey = (userId: string) => `admin:mfa:fail:${userId}`;

export async function assertNotLocked(app: FastifyInstance, userId: string): Promise<void> {
  const n = Number(await app.redis.get(failKey(userId)));
  if (n >= MAX_FAILS) throw new AppError('MFA_LOCKED', 429, 'too many attempts, try again later');
}
export async function noteFailure(app: FastifyInstance, userId: string): Promise<void> {
  const k = failKey(userId);
  const n = await app.redis.incr(k);
  if (n === 1) await app.redis.expire(k, LOCK_SECONDS);
}
export const clearFailures = (app: FastifyInstance, userId: string) =>
  app.redis.del(failKey(userId));

export const sealSecret = (app: FastifyInstance, secret: string) =>
  encryptToken(secret, mfaKey(app));
export const openSecret = (app: FastifyInstance, sealed: string) =>
  decryptToken(sealed, mfaKey(app));
