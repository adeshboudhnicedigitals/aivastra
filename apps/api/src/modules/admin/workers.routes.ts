import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './guard.js';

export async function adminWorkersRoutes(app: FastifyInstance) {
  app.get(
    '/admin/workers',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']) },
    async () => {
      const raw = await app.redis.hgetall('worker:registry');
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        try {
          out[k] = JSON.parse(v);
        } catch {
          out[k] = v;
        }
        out[`${k}:health`] = (await app.redis.get(`worker:health:${k}`)) ?? 'UNHEALTHY';
      }
      return out;
    },
  );

  app.post(
    '/admin/workers/:id/drain',
    {
      preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR']),
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { id } = req.params as any;
      const raw = await app.redis.hget('worker:registry', id);
      if (!raw) return { ok: false };
      const w = JSON.parse(raw);
      await app.redis.hset('worker:registry', id, JSON.stringify({ ...w, status: 'DRAINING' }));
      return { ok: true };
    },
  );
}
