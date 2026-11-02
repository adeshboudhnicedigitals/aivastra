import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAIM_LUA, CLAIM_SPECIFIC_LUA } from './selector.js';

// Real Redis, not a mock: the isolation guarantee lives inside the Lua claim scripts,
// which a mocked `eval` cannot exercise. Uses throwaway keys so it touches nothing live.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const run = randomUUID();
const REGISTRY = `test:${run}:registry`;
const HEALTH = `test:${run}:health:`;
const CURSOR = `test:${run}:cursor`;
const RESERVATIONS = `test:${run}:reservations`;
const ADMISSION = `test:${run}:admission`;
let reachable = false;

const workers: Record<string, string[]> = {
  open: [], // empty = accepts any pool, EXCEPT inhouse
  tryonOnly: ['tryon'],
  inhouseOnly: ['inhouse'],
  mixed: ['tryon', 'inhouse'],
};

async function seed(): Promise<void> {
  await redis.del(REGISTRY, RESERVATIONS);
  await redis.set(ADMISSION, '1');
  for (const [id, allowedJobTypes] of Object.entries(workers)) {
    await redis.hset(
      REGISTRY,
      id,
      JSON.stringify({ url: `http://${id}`, apiKey: 'k', status: 'IDLE', allowedJobTypes }),
    );
    await redis.set(`${HEALTH}${id}`, '1', 'EX', 60);
  }
}

async function claimShared(jobType: string): Promise<string | null> {
  const r = (await redis.eval(
    CLAIM_LUA,
    5,
    REGISTRY,
    HEALTH,
    CURSOR,
    RESERVATIONS,
    ADMISSION,
    String(Date.now()),
    jobType,
    '',
    '0',
    'token',
  )) as string[] | false;
  return r ? (r[0] as string) : null;
}

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
  if (reachable)
    await redis.del(
      REGISTRY,
      CURSOR,
      RESERVATIONS,
      ADMISSION,
      ...Object.keys(workers).map((i) => HEALTH + i),
    );
  redis.disconnect();
});

describe('inhouse worker isolation (real Redis)', () => {
  it('an inhouse claim only ever returns workers that list inhouse', async (ctx) => {
    if (!reachable) return ctx.skip();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await seed();
      const id = await claimShared('inhouse');
      expect(id).not.toBeNull();
      seen.add(id as string);
    }
    expect([...seen].every((id) => id === 'inhouseOnly' || id === 'mixed')).toBe(true);
  });

  it('an inhouse claim fails when no worker lists inhouse, even with an accept-all worker', async (ctx) => {
    if (!reachable) return ctx.skip();
    await seed();
    await redis.hdel(REGISTRY, 'inhouseOnly', 'mixed');
    expect(await claimShared('inhouse')).toBeNull();
  });

  it('a tryon claim never returns an inhouse-only worker', async (ctx) => {
    if (!reachable) return ctx.skip();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await seed();
      const id = await claimShared('tryon');
      expect(id).not.toBeNull();
      seen.add(id as string);
    }
    expect(seen.has('inhouseOnly')).toBe(false);
    expect(seen.has('open')).toBe(true);
  });

  it('the pinned claim refuses an accept-all worker for inhouse but takes an inhouse one', async (ctx) => {
    if (!reachable) return ctx.skip();
    await seed();
    const claim = (id: string, pool: string) =>
      redis.eval(
        CLAIM_SPECIFIC_LUA,
        4,
        REGISTRY,
        HEALTH,
        RESERVATIONS,
        ADMISSION,
        id,
        String(Date.now()),
        pool,
        'token',
      );
    expect(await claim('open', 'inhouse')).toBeFalsy();
    expect(await claim('tryonOnly', 'inhouse')).toBeFalsy();
    expect(await claim('inhouseOnly', 'tryon')).toBeFalsy();
    expect(await claim('inhouseOnly', 'inhouse')).toEqual(['http://inhouseOnly', 'k']);
  });
});
