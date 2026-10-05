import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGISTRY_KEY } from '../../src/worker/registry.js';
import { CLAIM_LUA, selectWorker } from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';

const prefix = `perf-test-${Date.now()}:`;
const registry = `${prefix}registry`;
const cursor = `${prefix}cursor`;
const health = `${prefix}health:`;
const key = `${prefix}template:1`;
const configKey = 'config:perf-routing';
let redis: Redis;
let originalConfig: string | null;
let mock: ComfyMock;
async function config(mode: string) {
  await redis.set(
    configKey,
    JSON.stringify({
      mode,
      pools: { tryon: mode },
      cachePolicyFrozen: true,
      cacheExcludeThreshold: 5,
    }),
  );
}
async function workers(order = ['A', 'B', 'C']) {
  await redis.del(registry, cursor);
  for (const id of order) {
    await redis.hset(
      registry,
      id,
      JSON.stringify({ status: 'IDLE', url: mock.url, apiKey: 'test', allowedJobTypes: ['tryon'] }),
    );
    await redis.set(`${health}${id}`, '1');
  }
}
async function claim(excluded: string[] = []) {
  return (await redis.eval(
    CLAIM_LUA,
    3,
    registry,
    health,
    cursor,
    String(Date.now()),
    'tryon',
    key,
    '1',
    ...excluded,
  )) as string[] | null;
}
async function roundRobinChoice() {
  const fields = Object.keys(await redis.hgetall(registry));
  return fields[(Number((await redis.get(cursor)) ?? 0) + 1) % fields.length];
}
async function idle(id: string) {
  const raw = await redis.hget(registry, id);
  await redis.hset(registry, id, JSON.stringify({ ...JSON.parse(raw ?? '{}'), status: 'IDLE' }));
}

describe('atomic performance ordering', () => {
  beforeAll(async () => {
    redis = new Redis('redis://127.0.0.1:6379');
    originalConfig = await redis.get(configKey);
    mock = await startComfyMock();
  });
  beforeEach(async () => {
    await config('active');
    await workers();
    await redis.del(`perf:score:${key}`);
    await redis.set(`perf:baseline:${key}`, '200');
    await redis.hset(`perf:score:${key}`, { A: 150, B: 100, C: 300 });
    await redis.del('worker:probe-backoff:A', 'worker:probe-backoff:B', 'worker:probe-backoff:C');
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.del(
      `perf:score:${key}`,
      `perf:baseline:${key}`,
      'worker:probe-backoff:A',
      'worker:probe-backoff:B',
      'worker:probe-backoff:C',
    );
    if (originalConfig) await redis.set(configKey, originalConfig);
    else await redis.del(configKey);
    await mock.close();
    redis.disconnect();
  });
  it('claims B -> A -> C, then none; BUSY never eligible', async () => {
    expect((await claim())?.[0]).toBe('B');
    expect((await claim())?.[0]).toBe('A');
    expect((await claim())?.[0]).toBe('C');
    expect(await claim()).toBeNull();
  });
  it('claims atomically under concurrency', async () => {
    const results = await Promise.all([claim(), claim()]);
    expect(new Set(results.map((result) => result?.[0])).size).toBe(2);
  });
  it.each([
    ['A', 'B', 'C'],
    ['C', 'B', 'A'],
    ['B', 'A', 'C'],
  ])('ties against a single minimum in order %s %s %s', async (a, b, c) => {
    await workers([a, b, c]);
    await redis.hset(`perf:score:${key}`, { A: 100, B: 109, C: 118 });
    await redis.set(cursor, '1');
    const fields = Object.keys(await redis.hgetall(registry));
    const rotated = [...fields.slice(2), ...fields.slice(0, 2)];
    const expected = rotated.find((id) => id === 'A' || id === 'B');
    expect((await claim())?.[0]).toBe(expected);
  });
  it('unknown scores use baseline', async () => {
    await redis.hdel(`perf:score:${key}`, 'A');
    await redis.hset(`perf:score:${key}`, { B: 250, C: 300 });
    expect((await claim())?.[0]).toBe('A');
  });
  it('skips backed off workers and falls back to earliest expiry', async () => {
    await redis.set('worker:probe-backoff:B', '1', 'PX', 20_000);
    expect((await claim())?.[0]).toBe('A');
    await idle('A');
    await redis.set('worker:probe-backoff:A', '1', 'PX', 25_000);
    await redis.set('worker:probe-backoff:C', '1', 'PX', 15_000);
    expect((await claim())?.[0]).toBe('C');
  });
  it('honours exclusions and pool/health filters', async () => {
    expect((await claim(['B']))?.[0]).toBe('A');
    await idle('A');
    await redis.del(`${health}A`);
    await redis.hset(
      registry,
      'B',
      JSON.stringify({
        status: 'IDLE',
        url: mock.url,
        apiKey: 'test',
        allowedJobTypes: ['catalogue'],
      }),
    );
    expect((await claim())?.[0]).toBe('C');
  });
  it.each([
    ['A', 'B', 'C'],
    ['C', 'B', 'A'],
    ['B', 'A', 'C'],
  ])('OFF and OBSERVE claim identically while preferred differs in order %s %s %s', async (a, b, c) => {
    await workers([a, b, c]);
    const fields = Object.keys(await redis.hgetall(registry));
    const winnerIndex = fields.findIndex((id) => id !== 'A');
    // Redis hash order is unspecified; make round-robin differ from the scored preference.
    const initialCursor = (winnerIndex + fields.length - 1) % fields.length;
    await redis.set(cursor, String(initialCursor));
    await redis.hset(`perf:score:${key}`, { A: 50, B: 300, C: 400 });
    await config('off');
    const off = await claim();
    expect(off?.[0]).toBe(fields[winnerIndex]);
    await workers([a, b, c]);
    await redis.set(cursor, String(initialCursor));
    await config('observe');
    await redis.set('worker:probe-backoff:B', '1', 'PX', 20_000);
    const observe = await claim();
    expect(observe?.[0]).toBe(off?.[0]);
    expect(observe?.[3]).toBe('A');
    expect(observe?.[0]).not.toBe(observe?.[3]);
    expect(await redis.hget(registry, 'A')).toContain('IDLE');
  });
  it('optional candidate scanning cannot break a round-robin claim on later malformed registry data', async () => {
    const fields = Object.keys(await redis.hgetall(registry));
    const winner = fields[1];
    const later = fields[2];
    if (!winner || !later) throw new Error('fixture needs three workers');
    await redis.hset(registry, later, 'false');
    await config('off');
    expect((await claim())?.[0]).toBe(winner);
    await idle(winner);
    await redis.del(cursor);
    await config('observe');
    const observed = await claim();
    expect(observed?.[0]).toBe(winner);
    expect(observed?.[3]).toBe(winner);
  });
  it('mode flip applies next claim', async () => {
    await redis.hset(`perf:score:${key}`, { A: 50, B: 300, C: 400 });
    expect((await claim())?.[0]).toBe('A');
    await workers();
    await config('observe');
    const expected = await roundRobinChoice();
    expect((await claim())?.[0]).toBe(expected);
  });
  it.each([
    'missing_score',
    'wrong_score',
    'bad_score',
    'bad_config',
    'wrong_config',
    'missing_baseline',
    'wrong_baseline',
    'persistent_backoff',
    'bad_numeric_config',
    'malformed_pool',
  ])('fails soft for %s', async (fault) => {
    if (fault === 'missing_score') await redis.del(`perf:score:${key}`);
    if (fault === 'wrong_score') {
      await redis.del(`perf:score:${key}`);
      await redis.set(`perf:score:${key}`, 'x');
    }
    if (fault === 'bad_score') await redis.hset(`perf:score:${key}`, 'A', 'NaN');
    if (fault === 'bad_numeric_config')
      await redis.set(
        configKey,
        JSON.stringify({
          mode: 'active',
          pools: { tryon: 'active' },
          cachePolicyFrozen: true,
          cacheExcludeThreshold: 5,
          baselineMs: '100',
        }),
      );
    if (fault === 'malformed_pool')
      await redis.set(configKey, JSON.stringify({ mode: 'active', pools: { tryon: 42 } }));
    if (fault === 'bad_config') await redis.set(configKey, '{');
    if (fault === 'wrong_config') {
      await redis.del(configKey);
      await redis.hset(configKey, 'mode', 'active');
    }
    if (fault === 'missing_baseline') await redis.del(`perf:baseline:${key}`);
    if (fault === 'wrong_baseline') {
      await redis.del(`perf:baseline:${key}`);
      await redis.hset(`perf:baseline:${key}`, 'x', '1');
    }
    if (fault === 'persistent_backoff') await redis.set('worker:probe-backoff:A', '1');
    const expected = await roundRobinChoice();
    expect((await claim())?.[0]).toBe(expected);
  });
  it('production selector keeps ACTIVE blocked while executable count is unverified', async () => {
    const id = `${prefix}blocked`;
    await redis.hset(
      REGISTRY_KEY,
      id,
      JSON.stringify({ status: 'IDLE', url: mock.url, apiKey: 'test', allowedJobTypes: ['tryon'] }),
    );
    await redis.set(`worker:health:${id}`, '1');
    const worker = await selectWorker(redis, 'tryon', key);
    expect(worker?.performance?.selectionMode).toBe('observe');
    if (worker) {
      const raw = await redis.hget(REGISTRY_KEY, worker.id);
      if (raw)
        await redis.hset(
          REGISTRY_KEY,
          worker.id,
          JSON.stringify({ ...JSON.parse(raw), status: 'IDLE' }),
        );
    }
    await redis.hdel(REGISTRY_KEY, id);
    await redis.del(`worker:health:${id}`);
  });
});
