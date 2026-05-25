import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RegisterBody, LoginBody } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword, signAccess, newRefreshToken, hashRefresh } from './service.js';

export async function authRoutes(app: FastifyInstance) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.post('/v1/auth/register', { schema: { body: RegisterBody } }, async (req, reply) => {
    const { email, password, displayName } = req.body as any;
    const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
    const passwordHash = await hashPassword(password);
    const [user] = await app.db.insert(schema.users).values({ email, passwordHash, displayName }).returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    return issueTokens(app, user.id, reply, 201);
  });

  app.post('/v1/auth/login', {
    schema: { body: LoginBody },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = req.body as any;
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError('INVALID', 401, 'invalid credentials');
    return issueTokens(app, user.id, reply, 200);
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (!plain) throw new AppError('NO_REFRESH', 401, 'no refresh token');
    const tokenHash = hashRefresh(plain);
    const [row] = await app.db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
    if (!row || row.revoked || row.expiresAt < new Date()) throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    await app.db.update(schema.refreshTokens).set({ revoked: true }).where(eq(schema.refreshTokens.id, row.id));
    return issueTokens(app, row.userId, reply, 200);
  });

  app.get('/v1/me', { preHandler: app.requireUser }, async (req) => {
    const [user] = await app.db.select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      tier: schema.users.tier,
    }).from(schema.users).where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
    return user;
  });

  app.patch('/v1/me', {
    preHandler: app.requireUser,
    schema: {
      body: z.object({ displayName: z.string().min(1).max(60).optional() }),
    },
  }, async (req) => {
    const { displayName } = req.body as { displayName?: string };
    const [updated] = await app.db.update(schema.users)
      .set({ ...(displayName !== undefined ? { displayName } : {}) })
      .where(eq(schema.users.id, req.userId))
      .returning({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, tier: schema.users.tier });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'user not found');
    return updated;
  });

  app.post('/v1/auth/logout', { preHandler: app.requireUser }, async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (plain) {
      await app.db.update(schema.refreshTokens).set({ revoked: true })
        .where(eq(schema.refreshTokens.tokenHash, hashRefresh(plain)));
    }
    reply.clearCookie('refresh', { path: '/v1/auth' });
    return { ok: true };
  });

  async function issueTokens(app: FastifyInstance, userId: string, reply: any, status: number) {
    const accessToken = await signAccess(secret, userId, { kind: 'access' }, app.env.JWT_EXPIRY);
    const r = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY));
    await app.db.insert(schema.refreshTokens).values({ userId, tokenHash: r.hash, expiresAt });
    reply.setCookie('refresh', r.plain, {
      httpOnly: true, secure: app.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/v1/auth', expires: expiresAt, signed: false,
    });
    reply.code(status);
    return { accessToken };
  }
}

function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) throw new Error(`bad duration: ${s}`);
  const n = Number(m[1]);
  return n * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]!]!;
}
