import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

function retryStrategy(times: number): number | null {
  return Math.min(times * 200, 5000);
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    redisSub: Redis;
    // Dedicated client for @fastify/rate-limit only (see server.ts). Kept separate
    // from `redis` because `redis` is shared with shopify/sync-consumer.ts's
    // blocking XREADGROUP loop, which needs maxRetriesPerRequest: null (queue
    // forever while blocked — correct for a background consumer). Rate-limit runs
    // on every request's onRequest hook; sharing that same "queue forever" client
    // meant a single transient Redis reconnect stalled EVERY in-flight request for
    // up to ioredis's ~10s default connectTimeout (root cause of the Shopify
    // customer/presign → customer/jobs 100% drop-off — presign never fails, it's
    // just slow enough that the widget flow abandons before reaching the next
    // step). This client fails fast instead.
    redisRateLimit: Redis;
  }
}
export const redisPlugin = fp(async (app) => {
  const opts = { maxRetriesPerRequest: null as null, retryStrategy };
  const redis = new Redis(app.env.REDIS_URL, opts);
  const redisSub = new Redis(app.env.REDIS_URL, opts);
  const redisRateLimit = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: 2, retryStrategy });

  for (const [name, client] of [
    ['redis', redis],
    ['redisSub', redisSub],
    ['redisRateLimit', redisRateLimit],
  ] as const) {
    client.on('error', (err) => app.log.warn({ err, client: name }, 'redis client error'));
    client.on('reconnecting', () => app.log.warn({ client: name }, 'redis client reconnecting'));
  }

  app.decorate('redis', redis);
  app.decorate('redisSub', redisSub);
  app.decorate('redisRateLimit', redisRateLimit);
  app.addHook('onClose', async () => {
    redis.disconnect();
    redisSub.disconnect();
    redisRateLimit.disconnect();
  });
});
