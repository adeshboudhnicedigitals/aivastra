import { randomUUID } from 'node:crypto';
import type { Logger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkers, routingConfigKey } from '../../src/worker/registry.js';
import { selectWorker } from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';

const prefix = `selector-logs-${randomUUID()}:`;
const jobId = 'selector-log-job';
const credential = 'selector-log-integration-credential';
const A = 'skip-worker-a';
const B = 'skip-worker-b';
const skipMessage = 'worker busy or unreadable in ComfyUI — skipping';
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const ctx = { jobId, log: logger as unknown as Logger };
let control: Redis;
let redis: Redis;
let a: ComfyMock;
let b: ComfyMock;
let probes: string[];
async function startWith(id: string) {
  const order = Object.keys(await redis.hgetall('worker:registry'));
  await redis.set(
    'worker:rr_cursor',
    String((order.indexOf(id) - 1 + order.length) % order.length),
  );
}
function skipPayloads() {
  return logger.info.mock.calls
    .filter(([, message]) => message === skipMessage)
    .map(([payload]) => payload);
}

describe('selector redirects carry job and probe context', () => {
  beforeAll(async () => {
    control = new Redis('redis://127.0.0.1:6379');
    redis = control.duplicate({ keyPrefix: prefix });
    a = await startComfyMock();
    b = await startComfyMock();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    probes = [];
    for (const [id, mock] of [
      [A, a],
      [B, b],
    ] as const) {
      mock.setOptions({
        onRequest: (method, path) => {
          if (method === 'GET' && path === '/prompt') probes.push(id);
        },
      });
    }
    await registerWorkers(redis, [
      { id: A, url: a.url, apiKey: credential, allowedJobTypes: ['tryon'] },
      { id: B, url: b.url, apiKey: credential, allowedJobTypes: ['tryon'] },
    ]);
    for (const id of [A, B]) {
      await redis.set(`worker:health:${id}`, '1', 'EX', 30);
      await redis.set(routingConfigKey(id), JSON.stringify({ queueGateEnabled: true }));
    }
    await startWith(A);
  });
  afterEach(() => {
    const serialized = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain(a.url);
    expect(serialized).not.toContain(b.url);
    expect(serialized).not.toContain('apiKey');
  });
  afterAll(async () => {
    const keys = await control.keys(`${prefix}*`);
    if (keys.length) await control.del(...keys);
    await a.close();
    await b.close();
    redis.disconnect();
    control.disconnect();
  });
  it('skips the nonempty queue with job id and readable count, then claims the other worker', async () => {
    a.setOptions({
      queueRemaining: 1,
      onRequest: (_method, path) => {
        if (path === '/prompt') probes.push(A);
      },
    });
    const worker = await selectWorker(redis, 'tryon', undefined, ctx);
    expect(worker?.id).toBe(B);
    expect(probes).toEqual([A, B]);
    expect(skipPayloads()).toEqual([
      {
        workerId: A,
        pool: 'tryon',
        jobId,
        attempt: 1,
        reason: 'queue_not_empty',
        queueRemaining: 1,
        probeMs: expect.any(Number),
        selectionMode: 'off',
      },
    ]);
    expect(JSON.parse((await redis.hget('worker:registry', A)) ?? '{}').status).toBe('IDLE');
    expect(JSON.parse((await redis.hget('worker:registry', B)) ?? '{}').status).toBe('BUSY');
    expect(logger.info.mock.calls).toHaveLength(1);
  });
  it('HTTP 500 skips as unreadable with no queue count', async () => {
    a.setOptions({ promptStatus: 500 });
    expect((await selectWorker(redis, 'tryon', undefined, ctx))?.id).toBe(B);
    expect(skipPayloads()).toEqual([
      {
        workerId: A,
        pool: 'tryon',
        jobId,
        attempt: 1,
        reason: 'unreadable',
        probeMs: expect.any(Number),
        selectionMode: 'off',
      },
    ]);
    expect(skipPayloads()[0]).not.toHaveProperty('queueRemaining');
  });
  it('all externally busy candidates log ordered worker ids and reasons once before null', async () => {
    a.setOptions({ queueRemaining: 2 });
    b.setOptions({ queueRemaining: 1 });
    expect(await selectWorker(redis, 'tryon', undefined, ctx)).toBeNull();
    expect(skipPayloads().map((payload) => payload.workerId)).toEqual([A, B]);
    expect(skipPayloads().map((payload) => payload.attempt)).toEqual([1, 2]);
    expect(logger.info).toHaveBeenLastCalledWith(
      {
        pool: 'tryon',
        jobId,
        skippedWorkers: [A, B],
        reasons: ['queue_not_empty', 'queue_not_empty'],
      },
      'no eligible worker after probes',
    );
    expect(logger.info.mock.calls).toHaveLength(3);
  });
  it('the exhaustion summary preserves mixed skip reasons in worker order', async () => {
    a.setOptions({ queueRemaining: 3 });
    b.setOptions({ promptStatus: 500 });
    expect(await selectWorker(redis, 'tryon', undefined, ctx)).toBeNull();
    expect(logger.info).toHaveBeenLastCalledWith(
      { pool: 'tryon', jobId, skippedWorkers: [A, B], reasons: ['queue_not_empty', 'unreadable'] },
      'no eligible worker after probes',
    );
  });
  it('no eligible registry entry logs an empty summary without probing', async () => {
    for (const id of [A, B]) await redis.del(`worker:health:${id}`);
    expect(await selectWorker(redis, 'tryon', undefined, ctx)).toBeNull();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { pool: 'tryon', jobId, skippedWorkers: [], reasons: [] },
      'no eligible worker after probes',
    );
    expect(probes).toHaveLength(0);
  });
});
