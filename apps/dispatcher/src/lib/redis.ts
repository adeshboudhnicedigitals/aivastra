import { Redis } from 'ioredis';
import type { Env } from '../env.js';

export function makeRedis(env: Env) {
  const main = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
  const pub = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
  async function close() {
    main.disconnect();
    pub.disconnect();
  }
  return { main, pub, close };
}
