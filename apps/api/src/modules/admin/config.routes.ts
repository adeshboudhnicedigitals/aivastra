import type { FastifyInstance } from 'fastify';
import { SystemConfigBody } from '@aivastra/types';
import { requireAdmin } from './guard';

const KEY = 'config:system';

export async function adminConfigRoutes(app: FastifyInstance) {
  app.get('/admin/config', { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']) }, async () => {
    const raw = await app.redis.get(KEY);
    return raw ? JSON.parse(raw) : { creditCostPerJob: 1, maxJobsPerDay: 50 };
  });
  app.patch('/admin/config', {
    preHandler: requireAdmin(['SUPER_ADMIN']), schema: { body: SystemConfigBody },
  }, async (req) => {
    const cur = JSON.parse((await app.redis.get(KEY)) ?? '{}');
    const next = { ...cur, ...(req.body as any) };
    await app.redis.set(KEY, JSON.stringify(next));
    return next;
  });
  app.get('/admin/stats', { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']) }, async () => {
    const [queueN, queueP] = await Promise.all([app.redis.xlen('jobs:normal'), app.redis.xlen('jobs:priority')]);
    return { queue: { normal: queueN, priority: queueP } };
  });
}
