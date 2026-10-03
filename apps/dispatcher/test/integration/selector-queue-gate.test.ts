import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deregisterWorker,
  getWorkers,
  registerWorkers,
  routingConfigKey,
  setWorkerStatus,
} from '../../src/worker/registry.js';
import { selectWorker } from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';

const A = 'test-gate-a';
const B = 'test-gate-b';

/**
 * Queue-aware routing: a worker ComfyUI reports as busy (a dev's browser run) must not be
 * claimed for a production job, the probe fails closed, and every rejection releases the
 * worker and is excluded from the rest of that selection.
 */
describe('selectWorker — ComfyUI queue gate', () => {
  let redis: Redis;
  let a: ComfyMock;
  let b: ComfyMock;

  async function gate(id: string, on = true) {
    await redis.set(routingConfigKey(id), JSON.stringify({ queueGateEnabled: on }));
  }
  async function status(id: string) {
    return (await getWorkers(redis)).get(id)?.status;
  }

  beforeAll(async () => {
    redis = new Redis('redis://127.0.0.1:6379');
    a = await startComfyMock();
    b = await startComfyMock();
  });

  afterAll(async () => {
    await deregisterWorker(redis, A);
    await deregisterWorker(redis, B);
    await redis.del(routingConfigKey(A), routingConfigKey(B));
    await a.close();
    await b.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    a.setOptions({});
    b.setOptions({});
    // registerWorkers drops any registry entry not in this list, isolating our two workers.
    await registerWorkers(redis, [
      { id: A, url: a.url, apiKey: 'k', allowedJobTypes: ['tryon'] },
      { id: B, url: b.url, apiKey: 'k', allowedJobTypes: ['tryon'] },
    ]);
    await redis.setex(`worker:health:${A}`, 30, '1');
    await redis.setex(`worker:health:${B}`, 30, '1');
    await redis.del(routingConfigKey(A), routingConfigKey(B));
  });

  it('claims a free gated worker', async () => {
    await gate(A);
    await gate(B);
    const w = await selectWorker(redis, 'tryon');
    expect(w).not.toBeNull();
    expect(await status(w?.id as string)).toBe('BUSY');
  });

  it('skips a busy gated worker, releases it, and picks the free one', async () => {
    await gate(A);
    await gate(B);
    a.setOptions({ queueRemaining: 1 });
    for (let i = 0; i < 4; i++) {
      const w = await selectWorker(redis, 'tryon');
      expect(w?.id).toBe(B);
      await setWorkerStatus(redis, B, 'IDLE');
    }
    expect(await status(A)).toBe('IDLE');
  });

  it('returns null when every gated worker is externally busy, leaving both IDLE', async () => {
    await gate(A);
    await gate(B);
    a.setOptions({ queueRemaining: 2 });
    b.setOptions({ queueRemaining: 1 });
    expect(await selectWorker(redis, 'tryon')).toBeNull();
    expect(await status(A)).toBe('IDLE');
    expect(await status(B)).toBe('IDLE');
  });

  it.each([
    ['HTTP 500', { promptStatus: 500 }],
    ['invalid JSON', { promptBody: 'not json' }],
    ['missing exec_info', { promptBody: '{}' }],
    ['non-numeric queue_remaining', { promptBody: '{"exec_info":{"queue_remaining":"0"}}' }],
  ])('fails closed on %s', async (_name, opts) => {
    await gate(A);
    await deregisterWorker(redis, B);
    a.setOptions(opts);
    expect(await selectWorker(redis, 'tryon')).toBeNull();
    expect(await status(A)).toBe('IDLE');
  });

  it('does not probe a worker whose gate is off, even if ComfyUI reports a busy queue', async () => {
    a.setOptions({ queueRemaining: 5, promptStatus: 500 });
    await deregisterWorker(redis, B);
    const w = await selectWorker(redis, 'tryon');
    expect(w?.id).toBe(A);
  });

  it('never selects or restores a DRAINING worker', async () => {
    await gate(A);
    await gate(B);
    await setWorkerStatus(redis, A, 'DRAINING');
    b.setOptions({ queueRemaining: 1 });
    expect(await selectWorker(redis, 'tryon')).toBeNull();
    expect(await status(A)).toBe('DRAINING');
    expect(await status(B)).toBe('IDLE');
  });

  it('skips a worker of the wrong job type before any probe', async () => {
    await gate(A);
    await deregisterWorker(redis, B);
    a.setOptions({ promptStatus: 500 });
    expect(await selectWorker(redis, 'saree')).toBeNull();
  });
});
