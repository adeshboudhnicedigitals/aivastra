import { randomUUID } from 'node:crypto';
import {
  FLEET_HISTORY_MAX_POINTS,
  FLEET_HISTORY_WINDOW_MS,
  type WorkerSystemSample,
  workerHistoryKey,
} from '@aivastra/types';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordHistory, toHistoryPoint } from './system-history.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const sample = (
  observedAt: number,
  over: Partial<WorkerSystemSample> = {},
): WorkerSystemSample => ({
  observedAt,
  gpuName: 'Example GPU',
  vramTotalBytes: 96 * GIB,
  vramFreeBytes: 56 * GIB,
  ramTotalBytes: 80 * GIB,
  ramFreeBytes: 60 * GIB,
  ...over,
});

describe('toHistoryPoint', () => {
  it('derives used = total - free in the units /admin/fleet reports', () => {
    expect(toHistoryPoint(sample(1000))).toEqual({
      t: 1000,
      vramUsedMb: 40 * 1024,
      vramTotalMb: 96 * 1024,
      ramUsedGb: 20,
      ramTotalGb: 80,
    });
  });

  it('keeps unknown numbers null instead of turning them into zero', () => {
    expect(
      toHistoryPoint(sample(1, { vramTotalBytes: null, vramFreeBytes: null, ramFreeBytes: null })),
    ).toMatchObject({ vramUsedMb: null, vramTotalMb: null, ramUsedGb: null, ramTotalGb: 80 });
  });

  it('reports free > total as unknown used, never a negative figure', () => {
    const p = toHistoryPoint(sample(1, { vramFreeBytes: 100 * GIB, ramFreeBytes: 90 * GIB }));
    expect(p.vramUsedMb).toBeNull();
    expect(p.ramUsedGb).toBeNull();
    expect(p.vramTotalMb).toBe(96 * (GIB / MIB));
  });
});

// Real Redis: the trimming lives in the commands, which a mock would only echo back.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const workerId = `test-${randomUUID()}`;
const key = workerHistoryKey(workerId);
let reachable = false;

describe('recordHistory (real Redis)', () => {
  beforeAll(async () => {
    try {
      await redis.connect();
      await redis.ping();
      reachable = true;
    } catch {
      reachable = false;
    }
  });
  afterAll(async () => {
    if (reachable) await redis.del(key);
    redis.disconnect();
  });

  const times = async () =>
    (await redis.zrange(key, 0, -1)).map((m) => (JSON.parse(m) as { t: number }).t);

  it('appends points oldest first and sets an expiry', async (ctx) => {
    if (!reachable) return ctx.skip();
    await redis.del(key);
    const now = Date.now();
    await recordHistory(redis, workerId, sample(now - 30_000));
    await recordHistory(redis, workerId, sample(now - 15_000));
    await recordHistory(redis, workerId, sample(now));
    expect(await times()).toEqual([now - 30_000, now - 15_000, now]);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual((FLEET_HISTORY_WINDOW_MS * 2) / 1000);
  });

  it('drops points older than the window', async (ctx) => {
    if (!reachable) return ctx.skip();
    await redis.del(key);
    const now = Date.now();
    await recordHistory(redis, workerId, sample(now - FLEET_HISTORY_WINDOW_MS - 60_000));
    await recordHistory(redis, workerId, sample(now - 1000));
    await recordHistory(redis, workerId, sample(now));
    expect(await times()).toEqual([now - 1000, now]);
  });

  it('caps the count, keeping the newest', async (ctx) => {
    if (!reachable) return ctx.skip();
    await redis.del(key);
    const now = Date.now();
    const extra = 5;
    // Within the window (1 s apart), so only the count cap can remove anything.
    for (let i = 0; i < FLEET_HISTORY_MAX_POINTS + extra; i++) {
      await recordHistory(
        redis,
        workerId,
        sample(now - (FLEET_HISTORY_MAX_POINTS + extra - i) * 1000),
      );
    }
    const kept = await times();
    expect(kept).toHaveLength(FLEET_HISTORY_MAX_POINTS);
    expect(kept.at(-1)).toBe(now - 1000);
    expect(kept[0]).toBe(now - FLEET_HISTORY_MAX_POINTS * 1000);
  });
});
