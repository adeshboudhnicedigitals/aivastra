import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  effectiveScore,
  median,
  recordSample,
  refreshPerformanceScores,
  type Sample,
} from '../../src/perf/record-sample.js';
import { REGISTRY_KEY } from '../../src/worker/registry.js';
import { CLAIM_LUA } from '../../src/worker/selector.js';

const performanceKey = `samples-test-${Date.now()}:1`;
const ids = ['perf-sample-a', 'perf-sample-b', 'perf-sample-c'];
let redis: Redis;
let original: string | null;
const statsKey = (id = ids[0]) => `worker:perfstats:${id}:${performanceKey}`;
const timing = {
  executionStartMs: 1_000,
  executionSuccessMs: 2_000,
  cachedNodeCount: 1,
  totalNodeCount: 10,
};
function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    workerId: ids[0] as string,
    performanceKey,
    pool: 'tryon',
    outcome: 'success',
    executionTiming: timing,
    totalNodeCountReliable: true,
    ...overrides,
  };
}
async function stats() {
  return redis.hgetall(statsKey());
}
async function config(extra = {}) {
  await redis.set(
    'config:perf-routing',
    JSON.stringify({ mode: 'observe', baselineMs: 5_000, ...extra }),
  );
}

describe('aggregate performance sampling', () => {
  beforeAll(async () => {
    redis = new Redis('redis://127.0.0.1:6379');
    original = await redis.get('config:perf-routing');
    for (const id of ids)
      await redis.hset(
        REGISTRY_KEY,
        id,
        JSON.stringify({ status: 'IDLE', allowedJobTypes: ['tryon'] }),
      );
  });
  beforeEach(async () => {
    await config();
    await redis.del(
      ...ids.map((id) => statsKey(id)),
      `perf:score:${performanceKey}`,
      `perf:baseline:${performanceKey}`,
      `perf:score:${performanceKey}:ts`,
      `perf:cachedist:${performanceKey}`,
    );
  });
  afterAll(async () => {
    await redis.del(
      ...ids.map((id) => statsKey(id)),
      `perf:score:${performanceKey}`,
      `perf:baseline:${performanceKey}`,
      `perf:score:${performanceKey}:ts`,
      `perf:cachedist:${performanceKey}`,
    );
    await redis.hdel(REGISTRY_KEY, ...ids);
    if (original) await redis.set('config:perf-routing', original);
    else await redis.del('config:perf-routing');
    redis.disconnect();
  });
  it('seeds and updates EWMA at alpha 0.2 and expires aggregates', async () => {
    await recordSample(redis, sample());
    expect((await stats()).ewmaExecutionMs).toBe('1000');
    await config({
      mode: 'active',
      pools: { tryon: 'active' },
      cachePolicyFrozen: true,
      cacheExcludeThreshold: 5,
    });
    await recordSample(
      redis,
      sample({ executionTiming: { ...timing, executionSuccessMs: 3_000 } }),
    );
    expect((await stats()).ewmaExecutionMs).toBe('1200');
    expect((await stats()).sampleCount).toBe('2');
    expect(await redis.ttl(statsKey())).toBeGreaterThan(13 * 24 * 60 * 60);
    expect(await redis.ttl(`perf:score:${performanceKey}`)).toBeGreaterThan(13 * 24 * 60 * 60);
    expect((await stats()).cachePolicy).toBe('provisional');
  });
  it('admits unreliable counts provisionally while missing/invalid timing still skip', async () => {
    await recordSample(redis, sample({ executionTiming: undefined }));
    await recordSample(redis, sample({ totalNodeCountReliable: false }));
    await recordSample(redis, sample({ executionTiming: { ...timing, executionSuccessMs: 0 } }));
    const raw = await stats();
    expect(raw.sampleCount).toBe('1');
    expect(raw.cachePolicy).toBe('provisional');
    expect(raw.lastTotalNodeCountReliable).toBe('true');
    expect(await redis.hget(`perf:score:${performanceKey}`, ids[0] as string)).not.toBeNull();
    expect(raw.successCount).toBe('3');
    expect(raw.skip_missing_timing).toBe('1');
    expect(raw.skip_unknown_total_node_count).toBeUndefined();
    expect(raw.skip_invalid_timing).toBe('1');
  });
  it.each([
    ['cancelled', 'cancelledCount'],
    ['execution_timeout', 'timeoutCount'],
    ['workflow_failure', 'failedCount'],
    ['queue_timeout', 'queueTimeoutCount'],
    ['cleanup_failure', 'cleanupFailureCount'],
  ] as const)('%s increments only its counter', async (outcome, counter) => {
    await recordSample(redis, sample({ outcome }));
    expect((await stats())[counter]).toBe('1');
    expect((await stats()).sampleCount).toBeUndefined();
    expect((await stats()).ewmaExecutionMs).toBeUndefined();
  });
  it('skips fully cached provisionally and obeys a frozen threshold', async () => {
    await recordSample(redis, sample({ executionTiming: { ...timing, cachedNodeCount: 10 } }));
    expect((await stats()).cachedSkipCount).toBe('1');
    await config({ cacheExcludeThreshold: 2, cachePolicyFrozen: true });
    await recordSample(redis, sample({ executionTiming: { ...timing, cachedNodeCount: 3 } }));
    expect((await stats()).cachedSkipCount).toBe('2');
    await recordSample(redis, sample({ executionTiming: { ...timing, cachedNodeCount: 2 } }));
    expect((await stats()).sampleCount).toBe('1');
    expect((await stats()).cachePolicy).toBe('frozen');
  });
  it('blends sample confidence and age to baseline', () => {
    expect(effectiveScore({ ewmaExecutionMs: 100, sampleCount: 1, updatedAt: 0 }, 500, 0)).toBe(
      420,
    );
    expect(
      effectiveScore({ ewmaExecutionMs: 100, sampleCount: 5, updatedAt: 0 }, 500, 12 * 60 * 60_000),
    ).toBe(300);
    expect(
      effectiveScore({ ewmaExecutionMs: 100, sampleCount: 5, updatedAt: 0 }, 500, 24 * 60 * 60_000),
    ).toBe(500);
    expect(median([300, 100, 200])).toBe(200);
    expect(median([400, 100, 300, 200])).toBe(250);
  });
  it('switches to median after three mature workers and refreshes decay', async () => {
    for (let index = 0; index < ids.length; index++) {
      for (let n = 0; n < 5; n++)
        await recordSample(
          redis,
          sample({
            workerId: ids[index],
            executionTiming: {
              ...timing,
              executionSuccessMs: timing.executionStartMs + (index + 1) * 1_000,
            },
          }),
        );
    }
    expect(await redis.get(`perf:baseline:${performanceKey}`)).toBe('2000');
    await redis.hset(statsKey(), 'updatedAt', String(Date.now() - 24 * 60 * 60_000));
    await refreshPerformanceScores(redis);
    expect(Number(await redis.hget(`perf:score:${performanceKey}`, ids[0] as string))).toBe(2000);
  });
  it('reseed removes aggregates and restores configured baseline on fresh collection', async () => {
    for (let index = 0; index < ids.length; index++) {
      for (let n = 0; n < 5; n++) await recordSample(redis, sample({ workerId: ids[index] }));
    }
    expect(await redis.get(`perf:baseline:${performanceKey}`)).toBe('1000');
    await redis.del(
      ...ids.map((id) => statsKey(id)),
      `perf:score:${performanceKey}`,
      `perf:score:${performanceKey}:ts`,
      `perf:cachedist:${performanceKey}`,
    );
    await recordSample(redis, sample());
    expect(await redis.get(`perf:baseline:${performanceKey}`)).toBe('5000');
    expect(Number(await redis.hget(`perf:score:${performanceKey}`, ids[1] as string))).toBe(5000);
  });
  it('OFF collects nothing; failed writes never reject', async () => {
    await config({ mode: 'off' });
    await recordSample(redis, sample());
    expect(
      await redis.exists(
        statsKey(),
        `perf:cachedist:${performanceKey}`,
        `perf:score:${performanceKey}`,
      ),
    ).toBe(0);
    await config();
    await redis.set(statsKey(), 'corrupt');
    await expect(recordSample(redis, sample())).resolves.toBeUndefined();
  });

  it('OBSERVE provisional collection supplies usable preferred scores to the atomic claim', async () => {
    await recordSample(redis, sample({ totalNodeCountReliable: false }));
    expect((await stats()).cachePolicy).toBe('provisional');
    expect((await stats()).lastTotalNodeCountReliable).toBe('false');
    const registry = `${performanceKey}:registry`;
    const health = `${performanceKey}:health:`;
    const cursor = `${performanceKey}:cursor`;
    try {
      for (const id of ids) {
        await redis.hset(
          registry,
          id,
          JSON.stringify({
            status: 'IDLE',
            url: 'http://local.test',
            apiKey: 'test',
            allowedJobTypes: ['tryon'],
          }),
        );
        await redis.set(`${health}${id}`, '1');
      }
      const order = Object.keys(await redis.hgetall(registry));
      await redis.set(
        cursor,
        String((order.indexOf(ids[1] as string) - 1 + order.length) % order.length),
      );
      const claim = (await redis.eval(
        CLAIM_LUA,
        3,
        registry,
        health,
        cursor,
        String(Date.now()),
        'tryon',
        performanceKey,
        '0',
      )) as string[];
      expect(claim[0]).toBe(ids[1]);
      expect(claim[3]).toBe(ids[0]);
      expect(Number(claim[4])).toBe(5000);
      expect(Number(claim[5])).toBeGreaterThanOrEqual(4200);
      expect(Number(claim[5])).toBeLessThan(4300);
      expect(claim[6]).toBe('observe');
    } finally {
      await redis.del(registry, cursor, ...ids.map((id) => `${health}${id}`));
    }
  });
  it('cache distribution includes accepted/skipped successes and bounds distinct fields', async () => {
    await recordSample(redis, sample());
    await recordSample(redis, sample({ executionTiming: { ...timing, cachedNodeCount: 10 } }));
    expect(await redis.hgetall(`perf:cachedist:${performanceKey}`)).toEqual({
      '1': '1',
      '10': '1',
    });
    const fields = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), '1']));
    await redis.hset(`perf:cachedist:${performanceKey}`, fields);
    await recordSample(
      redis,
      sample({
        executionTiming: { ...timing, cachedNodeCount: 300 },
        totalNodeCountReliable: false,
      }),
    );
    expect(await redis.hlen(`perf:cachedist:${performanceKey}`)).toBe(256);
    expect(await redis.hget(`perf:cachedist:${performanceKey}`, '300')).toBeNull();
    await recordSample(redis, sample());
    expect(await redis.hget(`perf:cachedist:${performanceKey}`, '1')).toBe('2');
    expect(await redis.ttl(`perf:cachedist:${performanceKey}`)).toBeGreaterThan(13 * 24 * 60 * 60);
  });
  it('corrupt numeric aggregate fields cannot poison a fresh EWMA or counters', async () => {
    await redis.hset(statsKey(), {
      sampleCount: 'bad',
      ewmaExecutionMs: 'bad',
      successCount: 'bad',
    });
    await recordSample(redis, sample());
    expect((await stats()).sampleCount).toBe('1');
    expect((await stats()).ewmaExecutionMs).toBe('1000');
    expect((await stats()).successCount).toBe('1');
  });
  it('corrupt sibling aggregates do not prevent score writes or refresh', async () => {
    await redis.set(statsKey(ids[1]), 'corrupt');
    await expect(recordSample(redis, sample())).resolves.toBeUndefined();
    expect(await redis.hget(`perf:score:${performanceKey}`, ids[0] as string)).not.toBeNull();
    await expect(refreshPerformanceScores(redis)).resolves.toBeUndefined();
  });
});
