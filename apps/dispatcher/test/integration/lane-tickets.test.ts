import { randomUUID } from 'node:crypto';
import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../../src/job/processor.js';

// processJob is the one thing faked here: the tests are about slot accounting, not about what a
// recovered job does once it runs.
const gate = vi.hoisted(() => ({ release: null as null | (() => void), started: 0 }));
vi.mock('../../src/job/processor.js', () => ({
  processJob: () => {
    gate.started++;
    return new Promise<void>((resolve) => {
      gate.release = resolve;
    });
  },
}));

const { laneOccupancy, pruneLaneOccupancy, resetLaneTickets, restoreLaneOccupancy } = await import(
  '../../src/stream/lane-tickets.js'
);
const { runStreamLoop } = await import('../../src/stream/loop.js');
const { recoverPendingJobs } = await import('../../src/stream/recovery.js');

const GROUP = 'dispatcher-cg';
const log = createLogger('lane-tickets-test');

// Real Redis, one random key prefix; XGROUP and the stream names the lanes use are fixed, so the
// prefix is what isolates this file. ioredis does not prefix XGROUP's key: spell it out.
describe('lane tickets', () => {
  const run = randomUUID();
  const prefix = `lane-tickets:${run}:`;
  let redis: Redis;
  const cfg = {} as ProcessorConfig;

  beforeAll(async () => {
    redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: prefix });
    await redis.call('XGROUP', 'CREATE', `${prefix}jobs:normal`, GROUP, '$', 'MKSTREAM');
  });
  afterEach(() => {
    resetLaneTickets();
    gate.started = 0;
    gate.release = null;
  });
  afterAll(async () => {
    await redis.del('jobs:normal');
    redis.disconnect();
  });

  /** Entries a previous dispatcher left pending under another consumer. */
  async function leavePending(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++)
      ids.push((await redis.xadd('jobs:normal', '*', 'jobId', `j${i}`, 'userId', 'u')) as string);
    await redis.xreadgroup('GROUP', GROUP, 'old-host', 'COUNT', n, 'STREAMS', 'jobs:normal', '>');
    return ids;
  }

  function laneLoop(concurrency: number) {
    let reads = 0;
    const stop = runStreamLoop(cfg, log, {
      name: 'gpu',
      read: async () => {
        reads++;
        await new Promise((r) => setTimeout(r, 20));
        return null;
      },
      getConcurrency: async () => concurrency,
    });
    return { stop, reads: () => reads };
  }
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  it('restored placeholders occupy the lane before any fresh read, and are freed once ACKed', async () => {
    const ids = await leavePending(2);
    await restoreLaneOccupancy(redis, log, 200);
    expect(laneOccupancy('gpu')).toBe(2);

    // Cap equals the pending count: every slot is occupied, so no fresh read starts.
    const full = laneLoop(2);
    await settle();
    full.stop();
    expect(full.reads()).toBe(0);

    await redis.xack('jobs:normal', GROUP, ...ids);
    await pruneLaneOccupancy(redis, log);
    expect(laneOccupancy('gpu')).toBe(0);
    const free = laneLoop(2);
    await settle();
    free.stop();
    expect(free.reads()).toBeGreaterThan(0);
  });

  it('the restore is bounded by its limit', async () => {
    const ids = await leavePending(3);
    await restoreLaneOccupancy(redis, log, 2);
    expect(laneOccupancy('gpu')).toBe(2);
    await redis.xack('jobs:normal', GROUP, ...ids);
  });

  it('adoption-at-zero-cap: recovery runs and holds a ticket at cap zero; fresh reads stay blocked', async () => {
    const [id] = await leavePending(1);
    await restoreLaneOccupancy(redis, log, 200);
    const zero = laneLoop(0);

    const recovery = recoverPendingJobs(redis, cfg, 0, log, ['jobs:normal'], { background: true });
    await recovery;
    // The recovered job started although the cap is zero, and its slot stays counted.
    expect(gate.started).toBe(1);
    expect(laneOccupancy('gpu')).toBe(1);
    await settle();
    expect(zero.reads()).toBe(0);

    gate.release?.();
    await settle(50);
    // Ticket released at the end of the run; the entry is still pending (it yielded), so its
    // occupancy is the worker hold, not a lane slot.
    expect(laneOccupancy('gpu')).toBe(0);
    zero.stop();
    if (id) await redis.xack('jobs:normal', GROUP, id);
  });

  it('a recovery ticket counts against a positive cap while the recovered job runs', async () => {
    await leavePending(1);
    await recoverPendingJobs(redis, cfg, 0, log, ['jobs:normal'], { background: true });
    expect(laneOccupancy('gpu')).toBe(1);
    const one = laneLoop(1);
    await settle();
    expect(one.reads()).toBe(0);
    gate.release?.();
    await settle(100);
    const after = one.reads();
    await settle();
    one.stop();
    expect(one.reads()).toBeGreaterThan(after);
    await redis.xtrim('jobs:normal', 'MAXLEN', 0);
  });
});
