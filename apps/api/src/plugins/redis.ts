import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

function retryStrategy(times: number): number | null {
  return Math.min(times * 200, 5000);
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    redisSub: Redis;
  }
}
export const redisPlugin = fp(async (app) => {
  const opts = { maxRetriesPerRequest: null as null, retryStrategy };
  const redis = new Redis(app.env.REDIS_URL, opts);
  const redisSub = new Redis(app.env.REDIS_URL, opts);
  redis.on('error', () => {});
  redisSub.on('error', () => {});
  app.decorate('redis', redis);
  app.decorate('redisSub', redisSub);
  app.addHook('onClose', async () => {
    redis.disconnect();
    redisSub.disconnect();
  });
});
