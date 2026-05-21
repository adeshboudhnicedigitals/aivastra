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
    const queryToken = (req.query as Record<string, string | undefined>).token;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : queryToken;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    try {
      const payload = await verifyAccess(secret, token);
      req.userId = String(payload.sub);
    } catch { throw new AppError('UNAUTH', 401, 'invalid token'); }
  });
});
