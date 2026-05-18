import fp from 'fastify-plugin';
import { verifyAccess } from '../modules/auth/service';
import { AppError } from '../lib/errors';
declare module 'fastify' {
  interface FastifyInstance { requireUser: (req: any, reply: any) => Promise<void> }
  interface FastifyRequest { userId: string }
}
export const authPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  app.decorate('requireUser', async (req, _reply) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AppError('UNAUTH', 401, 'missing bearer');
    try {
      const payload = await verifyAccess(secret, h.slice(7));
      req.userId = String(payload.sub);
    } catch { throw new AppError('UNAUTH', 401, 'invalid token'); }
  });
});
