import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { LoginBody, RegisterBody } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../lib/mailer.js';
import { hashPassword, hashRefresh, verifyPassword } from './service.js';
import { issueTokens } from './tokens.js';

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
      return issueTokens(app, user.id, reply, 200);
    },
  );

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies.refresh;
    if (!plain) throw new AppError('NO_REFRESH', 401, 'no refresh token');
    const tokenHash = hashRefresh(plain);
    const [row] = await app.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash));
    if (!row || row.revoked || row.expiresAt < new Date())
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    await app.db
      .update(schema.refreshTokens)
      .set({ revoked: true })
      .where(eq(schema.refreshTokens.id, row.id));
    return issueTokens(app, row.userId, reply, 200);
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

  app.post('/v1/auth/logout', { preHandler: app.requireUser }, async (req, reply) => {
    const plain = req.cookies.refresh;
    if (plain) {
      await app.db
        .update(schema.refreshTokens)
        .set({ revoked: true })
        .where(eq(schema.refreshTokens.tokenHash, hashRefresh(plain)));
    }
    reply.clearCookie('refresh', { path: '/v1/auth' });
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
      return issueTokens(app, userId, reply, 200);
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
        .set({ revoked: true })
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
        .set({ revoked: true })
        .where(eq(schema.refreshTokens.userId, userId));
      return { ok: true };
    },
  );
}
