import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminRole?: string;
  }
}

type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN';

export function requireAdmin(roles: AdminRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const app = req.server as FastifyInstance;
    await app.requireAdminUser(req, reply);
    const [a] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, req.userId));
    if (!a) throw new AppError('FORBIDDEN', 403, 'admin required');
    if (a.status !== 'active') throw new AppError('FORBIDDEN', 403, 'admin account not active');
    if (!roles.includes(a.role as AdminRole))
      throw new AppError('FORBIDDEN', 403, 'insufficient admin role');
    req.adminRole = a.role;
  };
}
