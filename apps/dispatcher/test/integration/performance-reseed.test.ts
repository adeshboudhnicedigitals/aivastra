import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';

const exec = promisify(execFile);

it('ops reseed is dry-run by default, deletes only aggregates/scores, and refuses ACTIVE', async () => {
  // Use a local logical DB with no performance aggregates; never clear unrelated local data.
  let redis: Redis | undefined;
  let url = '';
  for (let db = 15; db >= 10; db--) {
    const candidateUrl = `redis://127.0.0.1:6379/${db}`;
    const candidate = new Redis(candidateUrl);
    const keys = [
      ...(await candidate.keys('worker:perfstats:*')),
      ...(await candidate.keys('perf:score:*')),
      ...(await candidate.keys('perf:cachedist:*')),
    ];
    if (keys.length === 0 && (await candidate.exists('config:perf-routing')) === 0) {
      redis = candidate;
      url = candidateUrl;
      break;
    }
    candidate.disconnect();
  }
  if (!redis) throw new Error('No isolated local Redis DB available for reseed test');
  const stat = 'worker:perfstats:test-worker:template:1';
  const score = 'perf:score:template:1';
  const timestamp = `${score}:ts`;
  const distribution = 'perf:cachedist:template:1';
  const baseline = 'perf:baseline:template:1';
  const script = resolve('scripts/reseed-performance-routing.mts');
  const run = (args: string[]) =>
    exec(process.execPath, ['--import', 'tsx', script, ...args], {
      env: { ...process.env, REDIS_URL: url },
      timeout: 15_000,
    });
  try {
    await redis.hset(stat, 'sampleCount', '5');
    await redis.hset(score, 'test-worker', '100');
    await redis.set(timestamp, '1');
    await redis.hset(distribution, '3', '2');
    await redis.set(baseline, '200');
    await run([]);
    expect(await redis.exists(stat, score, timestamp, distribution)).toBe(4);
    await redis.set('config:perf-routing', JSON.stringify({ mode: 'active' }));
    await expect(run(['--apply'])).rejects.toThrow();
    expect(await redis.exists(stat, score, timestamp, distribution)).toBe(4);
    await redis.set('config:perf-routing', JSON.stringify({ mode: 'observe' }));
    await run(['--apply']);
    expect(await redis.exists(stat, score, timestamp, distribution)).toBe(0);
    expect(await redis.get(baseline)).toBe('200');
  } finally {
    await redis.del(stat, score, timestamp, distribution, baseline, 'config:perf-routing');
    redis.disconnect();
  }
}, 30_000);
