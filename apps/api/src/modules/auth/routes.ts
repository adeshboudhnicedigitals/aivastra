import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { LoginBody, RegisterBody } from '@aivastra/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../lib/mailer.js';
import {
  hashPassword,
  hashRefresh,
  newRefreshToken,
  signAccess,
  verifyPassword,
} from './service.js';
import { createSessionTokens, parseDuration } from './tokens.js';

const REFRESH_GRACE_MS = 3_000;

function makeToken(): string {
  return randomBytes(32).toString('hex');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', { schema: { body: RegisterBody } }, async (req, reply) => {
    const { email, password, displayName } = req.body as z.infer<typeof RegisterBody>;
    const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
    const passwordHash = await hashPassword(password);
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, passwordHash, displayName })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });

    // Send verification email
    const token = makeToken();
    await app.redis.set(`email:verify:${token}`, user.id, 'EX', 86400);
    try {
      await sendVerificationEmail(
        app.env.RESEND_API_KEY,
        app.env.EMAIL_FROM,
        app.env.WEB_URL,
        email,
        token,
      );
    } catch (err) {
      app.log.error({ err }, 'Failed to send verification email');
    }

    reply.code(201);
    return { requiresEmailVerification: true };
  });

  app.post(
    '/v1/auth/login',
    {
      schema: { body: LoginBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, password } = req.body as z.infer<typeof LoginBody>;
      const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!(await verifyPassword(user.passwordHash, password)))
        throw new AppError('INVALID', 401, 'invalid credentials');
      if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');
      return createSessionTokens(app, user.id, reply, 200);
    },
  );

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies.refresh;
    if (!plain) throw new AppError('NO_REFRESH', 401, 'no refresh token');
    const tokenHash = hashRefresh(plain);

    const result = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .for('update');

      if (!row || row.expiresAt < new Date() || row.revokedAt) return { kind: 'invalid' } as const;

      if (row.usedAt) {
        const age = Date.now() - row.usedAt.getTime();
        if (age > REFRESH_GRACE_MS) {
          return {
            kind: 'stale',
            familyId: row.familyId,
            userId: row.userId,
            generation: row.generation,
            tokenId: row.id,
            age,
          } as const;
        }
        // Grace window: find latest active generation in family (future-proof vs gaps)
        const [successor] = await tx
          .select({ userId: schema.refreshTokens.userId })
          .from(schema.refreshTokens)
          .where(
            and(
              eq(schema.refreshTokens.familyId, row.familyId),
              isNull(schema.refreshTokens.usedAt),
              isNull(schema.refreshTokens.revokedAt),
            ),
          )
          .orderBy(desc(schema.refreshTokens.generation))
          .limit(1);
        if (successor) return { kind: 'reissue', userId: successor.userId } as const;
        return { kind: 'invalid' } as const;
      }

      // ── First use: rotate ──
      // Must remain in same transaction.
      // Either both operations commit or neither does.
      await tx
        .update(schema.refreshTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.refreshTokens.id, row.id));

      const r = newRefreshToken();
      const expiresAt = new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY));
      await tx.insert(schema.refreshTokens).values({
        userId: row.userId,
        familyId: row.familyId,
        generation: row.generation + 1,
        tokenHash: r.hash,
        expiresAt,
      });

      return {
        kind: 'rotated',
        userId: row.userId,
        refreshPlain: r.plain,
        expiresAt,
      } as const;
    });

    // Phase 2: outside transaction
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);

    switch (result.kind) {
      case 'invalid':
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');

      case 'stale':
        app.log.warn(
          {
            event: 'REFRESH_TOKEN_STALE',
            familyId: result.familyId,
            userId: result.userId,
            generation: result.generation,
            tokenId: result.tokenId,
            ageMs: result.age,
          },
          'Stale refresh token denied without family revocation',
        );
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');

      case 'reissue':
        app.log.info(
          { event: 'REFRESH_TOKEN_REISSUE', userId: result.userId },
          'Concurrent refresh reissued',
        );
        return {
          accessToken: await signAccess(
            secret,
            result.userId,
            { kind: 'access' },
            app.env.JWT_EXPIRY,
          ),
        };

      case 'rotated':
        reply.setCookie('refresh', result.refreshPlain, {
          httpOnly: true,
          secure: app.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/v1/auth',
          expires: result.expiresAt,
          signed: false,
        });
        reply.code(200);
        return {
          accessToken: await signAccess(
            secret,
            result.userId,
            { kind: 'access' },
            app.env.JWT_EXPIRY,
          ),
        };
    }
  });

  app.get('/v1/me', { preHandler: app.requireUser }, async (req) => {
    const [user] = await app.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        tier: schema.users.tier,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
    return user;
  });

  app.patch(
    '/v1/me',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({ displayName: z.string().min(1).max(60).optional() }),
      },
    },
    async (req) => {
      const { displayName } = req.body as { displayName?: string };
      const [updated] = await app.db
        .update(schema.users)
        .set({ ...(displayName !== undefined ? { displayName } : {}) })
        .where(eq(schema.users.id, req.userId))
        .returning({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          tier: schema.users.tier,
        });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'user not found');
      return updated;
    },
  );

  app.post('/v1/auth/logout', async (req) => {
    const plain = req.cookies.refresh;
    if (plain) {
      const tokenHash = hashRefresh(plain);
      const [row] = await app.db
        .select({ familyId: schema.refreshTokens.familyId })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (row) {
        await app.db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.familyId, row.familyId));
      }
    }
    return { ok: true };
  });

  // ── Email verification ─────────────────────────────────────────────────────

  app.get(
    '/v1/auth/verify-email',
    { schema: { querystring: z.object({ token: z.string().min(1) }) } },
    async (req, reply) => {
      const { token } = req.query as { token: string };
      const userId = await app.redis.getdel(`email:verify:${token}`);
      if (!userId) throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, 'invalid or expired token');
      await app.db
        .update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.id, userId));
      return createSessionTokens(app, userId, reply, 200);
    },
  );

  app.post(
    '/v1/auth/resend-verification',
    {
      schema: { body: z.object({ email: z.string().email() }) },
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (req) => {
      const { email } = req.body as { email: string };
      const [user] = await app.db
        .select({ id: schema.users.id, emailVerified: schema.users.emailVerified })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      // Always return 200 — no email enumeration
      if (!user || user.emailVerified) return { sent: true };
      const token = makeToken();
      await app.redis.set(`email:verify:${token}`, user.id, 'EX', 86400);
      try {
        await sendVerificationEmail(
          app.env.RESEND_API_KEY,
          app.env.EMAIL_FROM,
          app.env.WEB_URL,
          email,
          token,
        );
      } catch (err) {
        app.log.error({ err }, 'Failed to resend verification email');
      }
      return { sent: true };
    },
  );

  // ── Password reset ─────────────────────────────────────────────────────────

  app.patch(
    '/v1/me/password',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8),
        }),
      },
    },
    async (req) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      const [user] = await app.db
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      if (!user?.passwordHash)
        throw new AppError('INVALID', 400, 'no password set on this account');
      if (!(await verifyPassword(user.passwordHash, currentPassword)))
        throw new AppError('WRONG_PASSWORD', 400, 'current password is incorrect');
      const passwordHash = await hashPassword(newPassword);
      await app.db
        .update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, req.userId));
      await app.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, req.userId));
      return { ok: true };
    },
  );

  app.post(
    '/v1/auth/forgot-password',
    {
      schema: { body: z.object({ email: z.string().email() }) },
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (req) => {
      const { email } = req.body as { email: string };
      const [user] = await app.db
        .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      // Always return 200 — no email enumeration
      if (!user?.passwordHash) return { sent: true };
      const token = makeToken();
      await app.redis.set(`email:reset:${token}`, user.id, 'EX', 3600);
      try {
        await sendPasswordResetEmail(
          app.env.RESEND_API_KEY,
          app.env.EMAIL_FROM,
          app.env.WEB_URL,
          email,
          token,
        );
      } catch (err) {
        app.log.error({ err }, 'Failed to send password reset email');
      }
      return { sent: true };
    },
  );

  app.post(
    '/v1/auth/reset-password',
    {
      schema: {
        body: z.object({
          token: z.string().min(1),
          newPassword: z.string().min(8),
        }),
      },
    },
    async (req) => {
      const { token, newPassword } = req.body as { token: string; newPassword: string };
      const userId = await app.redis.getdel(`email:reset:${token}`);
      if (!userId) throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, 'invalid or expired token');
      const passwordHash = await hashPassword(newPassword);
      await app.db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
      // Revoke all existing sessions for security
      await app.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, userId));
      return { ok: true };
    },
  );
}
