import { schema } from '@aivastra/db';
import { LoginBody, RegisterBody } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { hashPassword, hashRefresh, verifyPassword } from './service.js';
import { issueTokens } from './tokens.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', { schema: { body: RegisterBody } }, async (req, reply) => {
    const { email, password, displayName } = req.body as any;
    const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
    const passwordHash = await hashPassword(password);
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, passwordHash, displayName })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    return issueTokens(app, user.id, reply, 201);
  });

  app.post(
    '/v1/auth/login',
    {
      schema: { body: LoginBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, password } = req.body as any;
      const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
      if (!(await verifyPassword(user.passwordHash, password)))
        throw new AppError('INVALID', 401, 'invalid credentials');
      return issueTokens(app, user.id, reply, 200);
    },
  );

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies['refresh'];
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
    const plain = req.cookies['refresh'];
    if (plain) {
      await app.db
        .update(schema.refreshTokens)
        .set({ revoked: true })
        .where(eq(schema.refreshTokens.tokenHash, hashRefresh(plain)));
    }
    reply.clearCookie('refresh', { path: '/v1/auth' });
    return { ok: true };
  });
}
