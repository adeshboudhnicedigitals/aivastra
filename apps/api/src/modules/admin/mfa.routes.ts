import { schema } from '@aivastra/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createAdminSessionTokens } from '../auth/tokens.js';
import { recordAudit } from './audit.js';
import { requireAdmin } from './guard.js';
import {
  assertNotLocked,
  clearFailures,
  noteFailure,
  openSecret,
  readMfaToken,
  sealSecret,
} from './mfa.js';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp.js';

const RATE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
const pendingKey = (userId: string) => `admin:mfa:pending:${userId}`;

export async function adminMfaRoutes(app: FastifyInstance) {
  // Second step for an enrolled admin: a 6-digit code, or one recovery code.
  app.post(
    '/admin/auth/mfa/verify',
    {
      ...RATE,
      schema: {
        body: z.object({
          mfaToken: z.string().min(1),
          code: z.string().optional(),
          recoveryCode: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { mfaToken, code, recoveryCode } = req.body as {
        mfaToken: string;
        code?: string;
        recoveryCode?: string;
      };
      const userId = await readMfaToken(app, mfaToken, 'verify');
      await assertNotLocked(app, userId);

      const [admin] = await app.db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, userId));
      if (admin?.status !== 'active' || !admin.totpSecretEnc || !admin.totpEnabledAt) {
        throw new AppError('INVALID', 401, 'invalid code');
      }

      let ok = false;
      if (recoveryCode) {
        ok = await app.db.transaction(async (tx) => {
          const [row] = await tx
            .select({ hashes: schema.adminUsers.totpRecoveryHashes })
            .from(schema.adminUsers)
            .where(eq(schema.adminUsers.userId, userId))
            .for('update');
          const h = hashRecoveryCode(recoveryCode);
          if (!row?.hashes.includes(h)) return false;
          await tx
            .update(schema.adminUsers)
            .set({ totpRecoveryHashes: row.hashes.filter((x) => x !== h) })
            .where(eq(schema.adminUsers.userId, userId));
          await recordAudit(tx, {
            actor: { userId, role: admin.role },
            action: 'admin.mfa.recovery_used',
            resourceType: 'admin_user',
            resourceId: userId,
            after: { remaining: row.hashes.length - 1 },
            request: req,
          });
          return true;
        });
      } else if (code) {
        const step = verifyTotp(openSecret(app, admin.totpSecretEnc), code, admin.totpLastStep);
        if (step !== null) {
          // Atomic replay guard: only the request that advances last_step wins.
          const advanced = await app.db
            .update(schema.adminUsers)
            .set({ totpLastStep: step })
            .where(
              and(
                eq(schema.adminUsers.userId, userId),
                or(
                  isNull(schema.adminUsers.totpLastStep),
                  lt(schema.adminUsers.totpLastStep, step),
                ),
              ),
            )
            .returning({ id: schema.adminUsers.id });
          ok = advanced.length > 0;
        }
      }
      if (!ok) {
        await noteFailure(app, userId);
        throw new AppError('INVALID', 401, 'invalid code');
      }
      await clearFailures(app, userId);
      return createAdminSessionTokens(app, userId, reply, 200);
    },
  );

  // First-time enrolment, reachable only with the enroll-step token from a correct password.
  app.post(
    '/admin/auth/mfa/enroll/start',
    { ...RATE, schema: { body: z.object({ mfaToken: z.string().min(1) }) } },
    async (req) => {
      const userId = await readMfaToken(app, (req.body as { mfaToken: string }).mfaToken, 'enroll');
      await assertNotLocked(app, userId);
      const [row] = await app.db
        .select({ email: schema.users.email, enabledAt: schema.adminUsers.totpEnabledAt })
        .from(schema.adminUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.adminUsers.userId))
        .where(eq(schema.adminUsers.userId, userId));
      if (!row) throw new AppError('INVALID', 401, 'sign in again');
      if (row.enabledAt) throw new AppError('ALREADY_ENROLLED', 409, 'already enrolled');
      const secret = newTotpSecret();
      // Held sealed in Redis until a code proves the authenticator has it; nothing in Postgres yet.
      await app.redis.set(pendingKey(userId), sealSecret(app, secret), 'EX', 600);
      return { secret, otpauthUri: otpauthUri(row.email ?? 'admin', secret) };
    },
  );

  app.post(
    '/admin/auth/mfa/enroll/confirm',
    {
      ...RATE,
      schema: { body: z.object({ mfaToken: z.string().min(1), code: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { mfaToken, code } = req.body as { mfaToken: string; code: string };
      const userId = await readMfaToken(app, mfaToken, 'enroll');
      await assertNotLocked(app, userId);
      const sealed = await app.redis.get(pendingKey(userId));
      if (!sealed) throw new AppError('ENROLL_EXPIRED', 400, 'start enrolment again');
      const step = verifyTotp(openSecret(app, sealed), code, null);
      if (step === null) {
        await noteFailure(app, userId);
        throw new AppError('INVALID', 401, 'invalid code');
      }
      const recoveryCodes = newRecoveryCodes();
      await app.db.transaction(async (tx) => {
        const [admin] = await tx
          .update(schema.adminUsers)
          .set({
            totpSecretEnc: sealed,
            totpEnabledAt: new Date(),
            totpLastStep: step,
            totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
          })
          .where(and(eq(schema.adminUsers.userId, userId), isNull(schema.adminUsers.totpEnabledAt)))
          .returning({ role: schema.adminUsers.role });
        if (!admin) throw new AppError('ALREADY_ENROLLED', 409, 'already enrolled');
        await recordAudit(tx, {
          actor: { userId, role: admin.role },
          action: 'admin.mfa.enroll',
          resourceType: 'admin_user',
          resourceId: userId,
          request: req,
        });
      });
      await app.redis.del(pendingKey(userId));
      await clearFailures(app, userId);
      // Shown once: only hashes are stored.
      return { ...(await createAdminSessionTokens(app, userId, reply, 200)), recoveryCodes };
    },
  );

  // Lost phone and no recovery codes: a SUPER_ADMIN clears the factor. The person re-enrols at
  // their next login. Their sessions are revoked so a stolen session does not outlive the reset.
  app.post(
    '/admin/users/:id/mfa/reset',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      await app.db.transaction(async (tx) => {
        const [target] = await tx
          .update(schema.adminUsers)
          .set({
            totpSecretEnc: null,
            totpEnabledAt: null,
            totpLastStep: null,
            totpRecoveryHashes: [],
          })
          .where(eq(schema.adminUsers.userId, id))
          .returning({ role: schema.adminUsers.role });
        if (!target) throw new AppError('NOT_FOUND', 404, 'Admin not found');
        await tx
          .update(schema.refreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(
            and(eq(schema.refreshTokens.userId, id), eq(schema.refreshTokens.portal, 'admin')),
          );
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'admin.mfa.reset',
          resourceType: 'admin_user',
          resourceId: id,
          request: req,
        });
      });
      await app.redis.del(`admin:mfa:fail:${id}`, pendingKey(id));
      return { ok: true };
    },
  );
}
