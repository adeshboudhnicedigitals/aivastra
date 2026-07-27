import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess, verifyAdminAccess } from '../modules/auth/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireUserOrCatalogApp: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}
export const authPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.decorate('requireUser', async (req, _reply) => {
    const h = req.headers.authorization;
    // Header-only: access tokens must never travel in the query string (they leak
    // into proxy/access logs, browser history, Referer). SSE clients use a
    // fetch-based reader that sends the Authorization header (see web/admin sse.ts).
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    let userId: string;
    try {
      const payload = await verifyAccess(secret, token);
      // Reject tokens not issued for the user portal (kind must be 'access')
      if ((payload as Record<string, unknown>).kind !== 'access')
        throw new AppError('UNAUTH', 401, 'invalid token');
      // catalog-app tokens are deliberately restricted to requireMerchant routes.
      // This is the actual security boundary for the installable Try On Library.
      if ((payload as Record<string, unknown>).aud === 'catalog-app')
        throw new AppError('UNAUTH', 401, 'invalid token');
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

  // Same as requireUser but without the catalog-app audience rejection — for routes
  // that serve gender-scoped reference data with no per-user filtering (e.g. garment
  // types), shared by both the regular Studio wizard and the Try On Library mini-app.
  app.decorate('requireUserOrCatalogApp', async (req, _reply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    let userId: string;
    try {
      const payload = await verifyAccess(secret, token);
      if ((payload as Record<string, unknown>).kind !== 'access')
        throw new AppError('UNAUTH', 401, 'invalid token');
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
    // Header-only — see requireUser above.
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
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
