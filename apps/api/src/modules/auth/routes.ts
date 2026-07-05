import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { LoginBody, RegisterBody } from '@aivastra/types';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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

type RefreshOwnerType = 'user' | 'kioskDevice' | 'widgetClient';

type RefreshOwner = {
  ownerType: RefreshOwnerType;
  ownerId: string;
};

type RotationResult =
  | { kind: 'invalid' }
  | ({ kind: 'reissue' } & RefreshOwner)
  | ({
      kind: 'rotated';
      refreshPlain: string;
      expiresAt: Date;
    } & RefreshOwner);

function refreshOwner(row: {
  userId: string | null;
  kioskDeviceId: string | null;
  widgetClientId: string | null;
}): RefreshOwner | null {
  if (row.userId) return { ownerType: 'user', ownerId: row.userId };
  if (row.kioskDeviceId) return { ownerType: 'kioskDevice', ownerId: row.kioskDeviceId };
  if (row.widgetClientId) return { ownerType: 'widgetClient', ownerId: row.widgetClientId };
  return null;
}

function refreshOwnerInsert(owner: RefreshOwner) {
  if (owner.ownerType === 'user') return { userId: owner.ownerId };
  if (owner.ownerType === 'kioskDevice') return { kioskDeviceId: owner.ownerId };
  return { widgetClientId: owner.ownerId };
}

export async function rotateTokenFamily(
  app: FastifyInstance,
  plain: string,
  portal: string,
  refreshExpiry = app.env.REFRESH_TOKEN_EXPIRY,
): Promise<RotationResult> {
  const tokenHash = hashRefresh(plain);

  return app.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .for('update');

    if (!row || row.expiresAt < new Date() || row.revokedAt) return { kind: 'invalid' } as const;
    if (row.portal !== portal) return { kind: 'invalid' } as const;
    const owner = refreshOwner(row);
    if (!owner) return { kind: 'invalid' } as const;

    if (row.usedAt) {
      const ageMs = Date.now() - row.usedAt.getTime();
      const [successor] = await tx
        .select({
          userId: schema.refreshTokens.userId,
          kioskDeviceId: schema.refreshTokens.kioskDeviceId,
          widgetClientId: schema.refreshTokens.widgetClientId,
        })
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
      const successorOwner = successor ? refreshOwner(successor) : null;
      if (successorOwner) {
        app.log.info(
          { familyId: row.familyId, generation: row.generation, ageMs },
          'concurrent refresh: reissuing from active successor',
        );
        return { kind: 'reissue', ...successorOwner } as const;
      }
      app.log.warn(
        { familyId: row.familyId, generation: row.generation, ageMs },
        'stale refresh token with no active successor — possible replay attack',
      );
      return { kind: 'invalid' } as const;
    }

    // First use: rotate
    await tx
      .update(schema.refreshTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.refreshTokens.id, row.id));

    const r = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseDuration(refreshExpiry));
    await tx.insert(schema.refreshTokens).values({
      ...refreshOwnerInsert(owner),
      familyId: row.familyId,
      generation: row.generation + 1,
      tokenHash: r.hash,
      expiresAt,
      portal,
    });

    return {
      kind: 'rotated',
      ...owner,
      refreshPlain: r.plain,
      expiresAt,
    } as const;
  });
}
function makeToken(): string {
  return randomBytes(32).toString('hex');
}

export async function authRoutes(app: FastifyInstance) {
  // Pre-computed hash used on the not-found login path to prevent timing-based user enumeration
  const dummyHash = await hashPassword('__timing_dummy__');

  app.post(
    '/v1/auth/register',
    { schema: { body: RegisterBody }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password, displayName } = req.body as z.infer<typeof RegisterBody>;
      const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
      const passwordHash = await hashPassword(password);
      const [user] = await app.db
        .insert(schema.users)
        .values({ email, passwordHash, displayName, tier: 'free' })
        .returning();
      await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });

      const [freePlan] = await app.db
        .select({ credits: schema.creditPlans.credits })
        .from(schema.creditPlans)
        .where(and(eq(schema.creditPlans.slug, 'free'), eq(schema.creditPlans.isActive, true)));
      const freeCredits = freePlan?.credits ?? 0;
      if (freeCredits > 0) {
        await app.db
          .update(schema.userCredits)
          .set({
            balance: sql`${schema.userCredits.balance} + ${freeCredits}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.userCredits.userId, user.id));
        await app.db
          .insert(schema.creditLedger)
          .values({ userId: user.id, delta: freeCredits, reason: 'FREE_TRIAL' });
      }

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
    },
  );

  app.post(
    '/v1/auth/login',
    {
      schema: { body: LoginBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, password } = req.body as z.infer<typeof LoginBody>;
      const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (!user || user.isBanned) {
        await verifyPassword(dummyHash, password); // constant-time: prevent user enumeration via timing
        throw new AppError('INVALID', 401, 'invalid credentials');
      }
      if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!(await verifyPassword(user.passwordHash, password)))
        throw new AppError('INVALID', 401, 'invalid credentials');
      if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');
      const [adminRow] = await app.db
        .select({ role: schema.adminUsers.role, status: schema.adminUsers.status })
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, user.id));
      if (adminRow?.status === 'active' && adminRow.role === 'SUPER_ADMIN') {
        throw new AppError('FORBIDDEN', 403, 'Super admin accounts must use the admin panel.');
      }
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
      if (row.portal !== 'web') return { kind: 'invalid' } as const;
      if (!row.userId) return { kind: 'invalid' } as const;

      if (row.usedAt) {
        const ageMs = Date.now() - row.usedAt.getTime();
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
        if (successor?.userId) {
          app.log.info(
            { familyId: row.familyId, generation: row.generation, ageMs },
            'concurrent refresh: reissuing from active successor',
          );
          return { kind: 'reissue', userId: successor.userId } as const;
        }
        // Reuse of an already-rotated token with NO active successor signals
        // theft (the legitimate chain would have left a live successor). Revoke
        // the entire family so a stolen token can't keep the session alive —
        // forces re-login. (The successor branch above is the benign concurrent-
        // refresh race and is intentionally not revoked.)
        await tx
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.familyId, row.familyId));
        app.log.warn(
          { familyId: row.familyId, generation: row.generation, ageMs },
          'stale refresh token reuse — revoking family (possible theft)',
        );
        return { kind: 'invalid' } as const;
      }

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
        portal: 'web',
      });

      return {
        kind: 'rotated',
        userId: row.userId,
        refreshPlain: r.plain,
        expiresAt,
      } as const;
    });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);

    if (result.kind === 'invalid') {
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    }

    if (result.kind === 'reissue') {
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
    }

    // rotated
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
      accessToken: await signAccess(secret, result.userId, { kind: 'access' }, app.env.JWT_EXPIRY),
    };
  });

  app.get('/v1/me', { preHandler: app.requireUser }, async (req) => {
    const [user] = await app.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        phone: schema.users.phone,
        tier: schema.users.tier,
        passwordHash: schema.users.passwordHash,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
    const { passwordHash, ...rest } = user;
    return { ...rest, hasPassword: passwordHash !== null };
  });

  app.patch(
    '/v1/me',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          displayName: z.string().min(1).max(60).optional(),
          phone: z.string().max(20).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { displayName, phone } = req.body as { displayName?: string; phone?: string | null };
      const [updated] = await app.db
        .update(schema.users)
        .set({
          ...(displayName !== undefined ? { displayName } : {}),
          ...(phone !== undefined ? { phone: phone ?? null } : {}),
        })
        .where(eq(schema.users.id, req.userId))
        .returning({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          phone: schema.users.phone,
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

  // ── Mobile auth (body-based tokens, no cookies) ──────────────────────────

  app.post(
    '/v1/auth/login-mobile',
    {
      schema: { body: LoginBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { email, password } = req.body as z.infer<typeof LoginBody>;
      const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');

      const [adminRow] = await app.db
        .select({ passwordHash: schema.adminUsers.passwordHash, status: schema.adminUsers.status })
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, user.id));
      if (adminRow?.status !== 'active') throw new AppError('INVALID', 401, 'invalid credentials');
      if (!adminRow.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!(await verifyPassword(adminRow.passwordHash, password)))
        throw new AppError('INVALID', 401, 'invalid credentials');

      const secret = new TextEncoder().encode(app.env.JWT_SECRET);
      const accessToken = await signAccess(
        secret,
        user.id,
        { kind: 'access' },
        app.env.JWT_EXPIRY,
        'admin',
      );

      const r = newRefreshToken();
      const expiresAt = new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY));
      await app.db.insert(schema.refreshTokens).values({
        userId: user.id,
        familyId: randomUUID(),
        generation: 1,
        tokenHash: r.hash,
        expiresAt,
        portal: 'mobile',
      });

      return { accessToken, refreshToken: r.plain };
    },
  );

  app.post(
    '/v1/auth/refresh-body',
    {
      schema: { body: z.object({ refreshToken: z.string() }) },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { refreshToken } = req.body as { refreshToken: string };
      const result = await rotateTokenFamily(app, refreshToken, 'mobile');
      const secret = new TextEncoder().encode(app.env.JWT_SECRET);

      if (result.kind === 'invalid') {
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
      }
      if (result.ownerType !== 'user') {
        throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
      }

      if (result.kind === 'reissue') {
        return {
          accessToken: await signAccess(
            secret,
            result.ownerId,
            { kind: 'access' },
            app.env.JWT_EXPIRY,
            'admin',
          ),
          refreshToken: null,
        };
      }

      return {
        accessToken: await signAccess(
          secret,
          result.ownerId,
          { kind: 'access' },
          app.env.JWT_EXPIRY,
          'admin',
        ),
        refreshToken: result.refreshPlain,
      };
    },
  );

  app.post(
    '/v1/auth/logout-mobile',
    {
      schema: { body: z.object({ refreshToken: z.string() }) },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { refreshToken } = req.body as { refreshToken: string };
      const tokenHash = hashRefresh(refreshToken);
      const [row] = await app.db
        .select({ familyId: schema.refreshTokens.familyId, portal: schema.refreshTokens.portal })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (row?.portal === 'mobile') {
        await app.db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.familyId, row.familyId));
      }
      return { ok: true };
    },
  );

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
          currentPassword: z.string().min(1).optional(),
          newPassword: z.string().min(8),
        }),
      },
    },
    async (req) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword: string;
      };
      const [user] = await app.db
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      if (user?.passwordHash) {
        if (!currentPassword) throw new AppError('INVALID', 400, 'current password required');
        if (!(await verifyPassword(user.passwordHash, currentPassword)))
          throw new AppError('WRONG_PASSWORD', 400, 'current password is incorrect');
      }
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

  // Admin request
  app.post('/v1/auth/request-admin', { preHandler: app.requireUser }, async (req, reply) => {
    const [existing] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, req.userId));

    if (existing) {
      if (existing.status === 'active') {
        throw new AppError('CONFLICT', 409, 'already an active admin');
      }
      if (existing.status === 'pending') {
        return { status: 'pending', role: existing.role };
      }
      await app.db
        .update(schema.adminUsers)
        .set({ status: 'pending' })
        .where(eq(schema.adminUsers.userId, req.userId));
      reply.code(200);
      return { status: 'pending', role: existing.role };
    }

    await app.db.insert(schema.adminUsers).values({
      userId: req.userId,
      role: 'ADMIN',
      status: 'pending',
    });
    reply.code(201);
    return { status: 'pending', role: 'ADMIN' };
  });
}
