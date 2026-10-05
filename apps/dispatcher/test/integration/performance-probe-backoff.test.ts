import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectWorker } from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';

// Exercise ACTIVE mechanics with a hypothetical validated classifier; production stays blocked.
vi.mock('../../src/perf/performance-key.js', async (original) => ({
  ...(await original<object>()),
  NODE_COUNT_RULE_RELIABLE: true,
}));
const prefix = `probe-perf-${Date.now()}:`;
let redis: Redis;
let control: Redis;
let originalConfig: string | null;
let a: ComfyMock;
let b: ComfyMock;
const key = `${prefix}template:1`;
async function setup(mode: 'off' | 'observe' | 'active') {
  await control.set(
    'config:perf-routing',
    JSON.stringify({
      mode,
      pools: { tryon: mode },
      cachePolicyFrozen: true,
      cacheExcludeThreshold: 5,
    }),
  );
  await redis.del('worker:registry', 'worker:rr_cursor');
  for (const [id, mock] of [
    ['A', a],
    ['B', b],
  ] as const) {
    await redis.hset(
      'worker:registry',
      id,
      JSON.stringify({ status: 'IDLE', url: mock.url, apiKey: 'test', allowedJobTypes: ['tryon'] }),
    );
    await redis.set(`worker:health:${id}`, '1');
    await redis.set(`worker:routing-config:${id}`, JSON.stringify({ queueGateEnabled: true }));
    await redis.del(`worker:probe-backoff:${id}`);
    await control.del(`worker:probe-backoff:${id}`);
  }
  await control.set(`perf:baseline:${key}`, '200');
  await control.del(`perf:score:${key}`);
  await control.hset(`perf:score:${key}`, { A: 100, B: 300 });
  a.setOptions({ queueRemaining: 1 });
  b.setOptions({});
}

describe('post-claim performance backoff', () => {
  beforeAll(async () => {
    control = new Redis('redis://127.0.0.1:6379');
    redis = control.duplicate({ keyPrefix: prefix });
    originalConfig = await control.get('config:perf-routing');
    a = await startComfyMock();
    b = await startComfyMock();
  });
  beforeEach(async () => {
    await setup('active');
  });
  afterAll(async () => {
    const keys = await control.keys(`${prefix}*`);
    if (keys.length) await control.del(...keys);
    await control.del(
      `perf:score:${key}`,
      `perf:baseline:${key}`,
      'worker:probe-backoff:A',
      'worker:probe-backoff:B',
    );
    if (originalConfig) await control.set('config:perf-routing', originalConfig);
    else await control.del('config:perf-routing');
    await a.close();
    await b.close();
    redis.disconnect();
    control.disconnect();
  });
  it('ACTIVE releases and excludes a failed probe, writing a bounded TTL', async () => {
    const worker = await selectWorker(redis, 'tryon', key);
    expect(worker?.id).toBe('B');
    expect(worker?.performance?.selectionMode).toBe('active');
    expect(await redis.pttl('worker:probe-backoff:A')).toBeGreaterThan(15_000);
    expect(await redis.pttl('worker:probe-backoff:A')).toBeLessThanOrEqual(20_000);
    expect(JSON.parse((await redis.hget('worker:registry', 'A')) ?? '{}').status).toBe('IDLE');
  });
  it('OFF/OBSERVE route identically after failed probes and OBSERVE writes no backoff', async () => {
    await setup('off');
    const off = await selectWorker(redis, 'tryon', key);
    await setup('observe');
    const observe = await selectWorker(redis, 'tryon', key);
    expect(observe?.id).toBe(off?.id);
    expect(await redis.exists('worker:probe-backoff:A', 'worker:probe-backoff:B')).toBe(0);
    expect(await control.exists('worker:probe-backoff:A', 'worker:probe-backoff:B')).toBe(0);
  });
  it('corrupt ACTIVE scores fall back to OBSERVE and failed probes write no backoff', async () => {
    await control.del(`perf:score:${key}`);
    await control.set(`perf:score:${key}`, 'corrupt');
    // Choose A first using the actual hash order, so the failed probe is exercised.
    const order = Object.keys(await redis.hgetall('worker:registry'));
    await redis.set(
      'worker:rr_cursor',
      String((order.indexOf('A') - 1 + order.length) % order.length),
    );
    const worker = await selectWorker(redis, 'tryon', key);
    expect(worker?.id).toBe('B');
    expect(worker?.performance?.selectionMode).toBe('observe');
    expect(await redis.exists('worker:probe-backoff:A', 'worker:probe-backoff:B')).toBe(0);
    expect(await control.exists('worker:probe-backoff:A', 'worker:probe-backoff:B')).toBe(0);
  });
  it('health exclusion never writes probe backoff', async () => {
    await redis.del('worker:health:A');
    expect((await selectWorker(redis, 'tryon', key))?.id).toBe('B');
    expect(await redis.exists('worker:probe-backoff:A')).toBe(0);
  });
});
