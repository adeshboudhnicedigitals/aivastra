import { eq } from 'drizzle-orm';
import { schema } from '@aivastra/db';
import { AppError } from '../../lib/errors.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' { interface FastifyRequest { adminRole?: string } }

export function requireAdmin(roles: ('SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT')[]) {
  return async (req: FastifyRequest) => {
    const app = req.server as FastifyInstance;
    await app.requireUser(req as any, undefined as any);
    const [a] = await app.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.userId, req.userId));
    if (!a) throw new AppError('FORBIDDEN', 403, 'admin required');
    if (!roles.includes(a.role as any)) throw new AppError('FORBIDDEN', 403, 'insufficient admin role');
    req.adminRole = a.role;
  };
}
