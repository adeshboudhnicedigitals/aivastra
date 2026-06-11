import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminMeRoutes(app: FastifyInstance) {
  app.get(
    '/admin/me',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']) },
    async (req) => {
      const [user] = await app.db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
      return {
        userId: req.userId,
        email: user.email,
        role: req.adminRole,
        storagePublicUrl: app.env.R2_PUBLIC_URL.replace(/\/$/, ''),
      };
    },
  );
}
