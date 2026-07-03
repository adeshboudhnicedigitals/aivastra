import { Redis } from 'ioredis';
import type { Env } from '../env.js';

export function makeRedis(env: Env) {
  const opts = { maxRetriesPerRequest: null as null };
  const main = new Redis(env.REDIS_URL, opts);
  const pub = new Redis(env.REDIS_URL, opts);
  const sub = new Redis(env.REDIS_URL, opts);
  return {
    main,
    pub,
    sub,
    close: async () => {
      await Promise.all([main.quit(), pub.quit(), sub.quit()]);
    },
  };
}
