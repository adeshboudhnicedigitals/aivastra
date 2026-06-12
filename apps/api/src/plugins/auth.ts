import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess, verifyAdminAccess } from '../modules/auth/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: any, reply: any) => Promise<void>;
    requireAdminUser: (req: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}
export const authPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.decorate('requireUser', async (req, _reply) => {
    const h = req.headers.authorization;
    const queryToken = (req.query as Record<string, string | undefined>).token;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : queryToken;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    let userId: string;
    try {
      const payload = await verifyAccess(secret, token);
      // Reject admin-portal tokens from user routes
      const aud = payload.aud;
      const isAdmin = Array.isArray(aud) ? aud.includes('admin') : aud === 'admin';
      if (isAdmin) throw new AppError('UNAUTH', 401, 'invalid token');
      userId = String(payload.sub);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('UNAUTH', 401, 'invalid token');
    }
    const [user] = await app.db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new AppError('UNAUTH', 401, 'user not found');
    if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');
    req.userId = userId;
  });

  app.decorate('requireAdminUser', async (req, _reply) => {
    const h = req.headers.authorization;
    const queryToken = (req.query as Record<string, string | undefined>).token;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : queryToken;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    let userId: string;
    try {
      const payload = await verifyAdminAccess(secret, token);
      userId = String(payload.sub);
    } catch {
      throw new AppError('UNAUTH', 401, 'invalid token');
    }
    const [user] = await app.db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new AppError('UNAUTH', 401, 'user not found');
    if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'email not verified');
    req.userId = userId;
  });
});
