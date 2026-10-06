import { readFileSync } from 'node:fs';
import type { Logger } from '@aivastra/logger';
import { workerExternalBusyRejectionsTotal } from '@aivastra/observability';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQueueGateEnabled, releaseWorkerIfBusy } from './registry.js';
import { CLAIM_LUA, selectWorker } from './selector.js';

const moduleLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@aivastra/logger', () => ({ createLogger: () => moduleLog }));
vi.mock('./registry.js', () => ({
  REGISTRY_KEY: 'worker:registry',
  healthKey: (id: string) => `worker:health:${id}`,
  isQueueGateEnabled: vi.fn(async () => true),
  releaseWorkerIfBusy: vi.fn(async () => {}),
}));
const credential = 'selector-log-test-credential';
const privateQuery = 'selector-private-query';
const claim = [
  'w',
  `http://local.test/?private=${privateQuery}`,
  credential,
  'w',
  '',
  '',
  'off',
  '20000',
];
const fetchMock = vi.fn();
const jobLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const skipMessage = 'worker busy or unreadable in ComfyUI — skipping';
function redisWithClaims(count = 1) {
  const evalCommand = vi.fn();
  for (let i = 0; i < count; i++) evalCommand.mockResolvedValueOnce([...claim]);
  evalCommand.mockResolvedValue(null);
  return { eval: evalCommand, set: vi.fn() } as unknown as Redis;
}
function assertNoSecrets() {
  const payloads = JSON.stringify([
    ...moduleLog.info.mock.calls,
    ...moduleLog.warn.mock.calls,
    ...moduleLog.error.mock.calls,
    ...jobLog.info.mock.calls,
    ...jobLog.warn.mock.calls,
    ...jobLog.error.mock.calls,
  ]);
  expect(payloads).not.toContain(credential);
  expect(payloads).not.toContain(privateQuery);
  expect(payloads).not.toContain('apiKey');
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(isQueueGateEnabled).mockResolvedValue(true);
  vi.mocked(releaseWorkerIfBusy).mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ exec_info: { queue_remaining: 1 } }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('selector logging context', () => {
  it('omitted context uses the module logger and keeps rejection metric labels', async () => {
    const metric = vi.spyOn(workerExternalBusyRejectionsTotal, 'inc');
    const redis = redisWithClaims();
    expect(await selectWorker(redis, 'tryon')).toBeNull();
    expect(moduleLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'w',
        pool: 'tryon',
        attempt: 1,
        reason: 'queue_not_empty',
        queueRemaining: 1,
        selectionMode: 'off',
        probeMs: expect.any(Number),
      }),
      skipMessage,
    );
    expect(metric).toHaveBeenCalledWith({ reason: 'queue_not_empty_or_unreadable' });
    expect(jobLog.info).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledWith(
      CLAIM_LUA,
      3,
      'worker:registry',
      'worker:health:',
      'worker:rr_cursor',
      expect.any(String),
      'tryon',
      '',
      '0',
    );
    assertNoSecrets();
  });
  it.each([
    ['HTTP failure', { ok: false }],
    [
      'JSON failure',
      {
        ok: true,
        json: async () => {
          throw new Error('invalid JSON');
        },
      },
    ],
    ['missing field', { ok: true, json: async () => ({}) }],
    [
      'non-numeric field',
      { ok: true, json: async () => ({ exec_info: { queue_remaining: '0' } }) },
    ],
  ])('logs %s as unreadable with no queue count', async (_name, response) => {
    fetchMock.mockResolvedValue(response);
    expect(
      await selectWorker(redisWithClaims(), 'tryon', undefined, {
        jobId: 'job',
        log: jobLog as unknown as Logger,
      }),
    ).toBeNull();
    expect(jobLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job', reason: 'unreadable' }),
      skipMessage,
    );
    const payload = jobLog.info.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('queueRemaining');
    expect(moduleLog.info).not.toHaveBeenCalled();
    assertNoSecrets();
  });
  it('fetch timeout remains unreadable and retains the 2s timeout', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      throw new Error('probe timed out');
    });
    try {
      const result = selectWorker(redisWithClaims(), 'tryon', undefined, {
        jobId: 'job',
        log: jobLog as unknown as Logger,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await result).toBeNull();
      expect(timeout).toHaveBeenCalledWith(2_000);
      expect(jobLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unreadable', probeMs: 2_000 }),
        skipMessage,
      );
      assertNoSecrets();
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses the job logger for persistent release failure without exposing the claim', async () => {
    vi.mocked(releaseWorkerIfBusy).mockRejectedValue(new Error('release unavailable'));
    expect(
      await selectWorker(redisWithClaims(), 'tryon', undefined, {
        jobId: 'job',
        log: jobLog as unknown as Logger,
      }),
    ).toBeNull();
    expect(releaseWorkerIfBusy).toHaveBeenCalledTimes(2);
    expect(jobLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: 'w' }),
      'failed to release unused worker — stuck BUSY until restart',
    );
    expect(moduleLog.error).not.toHaveBeenCalled();
    assertNoSecrets();
  });
  it('logs ordered exclusions once when the existing four-probe limit is exhausted', async () => {
    const redis = redisWithClaims(4);
    expect(
      await selectWorker(redis, 'tryon', undefined, {
        jobId: 'job',
        log: jobLog as unknown as Logger,
      }),
    ).toBeNull();
    expect(redis.eval).toHaveBeenCalledTimes(4);
    expect(
      jobLog.info.mock.calls
        .filter(([, message]) => message === skipMessage)
        .map(([payload]) => payload.attempt),
    ).toEqual([1, 2, 3, 4]);
    expect(jobLog.info).toHaveBeenLastCalledWith(
      {
        pool: 'tryon',
        jobId: 'job',
        skippedWorkers: ['w', 'w', 'w', 'w'],
        reasons: Array(4).fill('queue_not_empty'),
      },
      'no eligible worker after probes',
    );
    assertNoSecrets();
  });
  it('gate off leaves claim values intact and performs no HTTP request or success log', async () => {
    vi.mocked(isQueueGateEnabled).mockResolvedValue(false);
    expect(
      await selectWorker(redisWithClaims(), 'tryon', undefined, {
        jobId: 'job',
        log: jobLog as unknown as Logger,
      }),
    ).toEqual({ id: 'w', url: claim[1], apiKey: credential });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobLog.info).not.toHaveBeenCalled();
    expect(moduleLog.info).not.toHaveBeenCalled();
  });
  it('all nine callers pass their existing job logger and id', () => {
    for (const [path, expected] of [
      ['../job/processor.ts', 8],
      ['../job/mannequin-phase.ts', 1],
    ] as const) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(
        source.match(
          /selectWorker\(redis, WORKER_POOL\.\w+, performanceKey, \{\s*jobId,\s*log: jobLog,?\s*\}\)/g,
        ),
      ).toHaveLength(expected);
    }
  });
});
