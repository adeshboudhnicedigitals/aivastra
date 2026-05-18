import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
declare module 'fastify' { interface FastifyInstance { redis: Redis; redisSub: Redis } }
export const redisPlugin = fp(async (app) => {
  const redis = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: null });
  const redisSub = new Redis(app.env.REDIS_URL);
  app.decorate('redis', redis); app.decorate('redisSub', redisSub);
  app.addHook('onClose', async () => { redis.disconnect(); redisSub.disconnect(); });
});
