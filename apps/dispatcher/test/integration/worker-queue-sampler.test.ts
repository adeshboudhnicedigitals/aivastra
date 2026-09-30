import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleQueue, sampleWorkerQueues } from '../../src/worker/queue-sampler.js';
import {
  deregisterWorker,
  queueSnapshotKey,
  registerWorkers,
  setWorkerStatus,
} from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';

const A = 'test-sampler-a';
const B = 'test-sampler-b';

describe('worker queue sampler (display snapshot)', () => {
  let redis: Redis;
  let a: ComfyMock;
  let b: ComfyMock;

  beforeAll(async () => {
    redis = new Redis('redis://127.0.0.1:6379');
    a = await startComfyMock();
    b = await startComfyMock();
  });

  afterAll(async () => {
    await deregisterWorker(redis, A);
    await deregisterWorker(redis, B);
    await redis.del(queueSnapshotKey(A), queueSnapshotKey(B));
    await a.close();
    await b.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    a.setOptions({});
    b.setOptions({});
    await registerWorkers(redis, [
      { id: A, url: a.url, apiKey: 'k' },
      { id: B, url: b.url, apiKey: 'k' },
    ]);
    await redis.del(queueSnapshotKey(A), queueSnapshotKey(B));
  });

  const snap = async (id: string) => {
    const raw = await redis.get(queueSnapshotKey(id));
    return raw ? JSON.parse(raw) : null;
  };

  it('counts running + pending from /queue', async () => {
    a.setOptions({ queueRunning: 1, queuePending: 2 });
    const s = await sampleQueue(a.url, 'k');
    expect(s).toMatchObject({ queueRemaining: 3, running: 1, pending: 2 });
    expect(s.error).toBeUndefined();
  });

  it('records an error (never throws) on a bad response', async () => {
    a.setOptions({ queueStatus: 500 });
    const s = await sampleQueue(a.url, 'k');
    expect(s.queueRemaining).toBeNull();
    expect(s.error).toContain('500');
  });

  it('writes a TTL snapshot only for healthy workers, with the error recorded per worker', async () => {
    b.setOptions({ queueStatus: 500 });
    await sampleWorkerQueues(redis, new Set([A, B]), createLogger('test'));
    expect(await snap(A)).toMatchObject({ queueRemaining: 0 });
    expect(await snap(B)).toMatchObject({ queueRemaining: null });
    expect(await redis.ttl(queueSnapshotKey(A))).toBeGreaterThan(0);

    await redis.del(queueSnapshotKey(A));
    await sampleWorkerQueues(redis, new Set([B]), createLogger('test'));
    expect(await snap(A)).toBeNull();
  });

  it('skips DRAINING workers', async () => {
    await setWorkerStatus(redis, A, 'DRAINING');
    await sampleWorkerQueues(redis, new Set([A]), createLogger('test'));
    expect(await snap(A)).toBeNull();
  });
});
