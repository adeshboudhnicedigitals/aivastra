import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';

const log = createLogger('performance-reseed');
const apply = process.argv.includes('--apply');
const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL must be explicitly supplied');
const redis = new Redis(url, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
  commandTimeout: 5_000,
});
redis.on('error', (err) => log.error({ err }, 'Redis connection error'));
await redis.connect();
try {
  const keys: string[] = [];
  for (const pattern of ['worker:perfstats:*', 'perf:score:*', 'perf:cachedist:*']) {
    let cursor = '0';
    do {
      const [next, matches] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...matches);
    } while (cursor !== '0');
  }
  log.info(
    {
      apply,
      count: keys.length,
      patterns: ['worker:perfstats:*', 'perf:score:*', 'perf:cachedist:*'],
    },
    'reseed removes aggregate samples and scores; fresh collection is required',
  );
  if (apply) {
    const config = await redis.get('config:perf-routing');
    const parsed = config ? JSON.parse(config) : {};
    if (parsed.mode === 'active' || Object.values(parsed.pools ?? {}).includes('active'))
      throw new Error('Switch ACTIVE pools to observe before reseeding');
    for (let i = 0; i < keys.length; i += 100) await redis.unlink(...keys.slice(i, i + 100));
  }
} finally {
  redis.disconnect();
}
