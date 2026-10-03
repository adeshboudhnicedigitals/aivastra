import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WaitForCompletionResult } from '../comfyui/progress.js';
import type { ClaimedWorker } from '../worker/selector.js';
import { observeCompletion, settlePerformanceSample } from './observe-completion.js';
import { recordSample } from './record-sample.js';

vi.mock('./record-sample.js', () => ({ recordSample: vi.fn(async () => {}) }));
const redis = {
  hget: vi.fn(async () => null),
  hgetall: vi.fn(async () => ({})),
  hmget: vi.fn(async () => []),
} as unknown as Redis;
const log = { info: vi.fn(), debug: vi.fn() } as unknown as Logger;
const graph = { node: { class_type: 'LoadImage', inputs: {} } };
const result: WaitForCompletionResult = {
  status: 'completed',
  executionTiming: {
    executionStartMs: 100,
    executionSuccessMs: 200,
    cachedNodeCount: 0,
    totalNodeCount: 1,
  },
};
const worker = (): ClaimedWorker => ({
  id: 'w',
  url: 'http://local.test',
  apiKey: 'test',
  performance: { selectionMode: 'observe', preferredWorker: 'w' },
});
beforeEach(() => {
  vi.clearAllMocks();
});

it('defers success until finalization commits, and settles only once', async () => {
  const w = worker();
  expect(
    await observeCompletion(redis, w, 'tryon', 'template:1', graph, log, async (count) => {
      expect(count).toBe(1);
      return result;
    }),
  ).toBe(result);
  expect(recordSample).not.toHaveBeenCalled();
  settlePerformanceSample(w, 'success');
  expect(recordSample).toHaveBeenCalledOnce();
  expect(recordSample).toHaveBeenCalledWith(
    redis,
    expect.objectContaining({
      workerId: 'w',
      performanceKey: 'template:1',
      outcome: 'success',
      executionTiming: result.executionTiming,
    }),
  );
  settlePerformanceSample(w, 'workflow_failure');
  expect(recordSample).toHaveBeenCalledOnce();
});
it.each([
  'cancelled',
  'workflow_failure',
] as const)('post-GPU %s never submits a successful sample', async (outcome) => {
  const w = worker();
  await observeCompletion(redis, w, 'tryon', 'template:1', graph, log, async () => result);
  settlePerformanceSample(w, outcome);
  expect(recordSample).toHaveBeenCalledOnce();
  expect(recordSample).toHaveBeenCalledWith(redis, expect.objectContaining({ outcome }));
});
it('wait errors remain unchanged and are not counted twice by the outer catch', async () => {
  const w = worker();
  const error = new Error('ComfyUI history polling timeout after 100ms');
  await expect(
    observeCompletion(redis, w, 'tryon', 'template:1', graph, log, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  settlePerformanceSample(w, 'workflow_failure');
  expect(recordSample).toHaveBeenCalledOnce();
  expect(recordSample).toHaveBeenCalledWith(
    redis,
    expect.objectContaining({ outcome: 'execution_timeout' }),
  );
});
it('OFF retains completion without collecting a sample', async () => {
  const w = worker();
  if (w.performance) w.performance.selectionMode = 'off';
  expect(
    await observeCompletion(redis, w, 'tryon', 'template:1', graph, log, async () => result),
  ).toBe(result);
  settlePerformanceSample(w, 'success');
  expect(recordSample).not.toHaveBeenCalled();
});

it('ungrouped workers read their group once and never poll the registry', async () => {
  vi.useFakeTimers();
  try {
    const w = worker();
    const waiting = observeCompletion(redis, w, 'tryon', 'template:1', graph, log, async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_100));
      return result;
    });
    await vi.advanceTimersByTimeAsync(3_100);
    await waiting;
    expect(redis.hget).toHaveBeenCalledOnce();
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(redis.hmget).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('grouped workers discover siblings once and poll only those entries', async () => {
  vi.useFakeTimers();
  vi.mocked(redis.hget).mockResolvedValueOnce(JSON.stringify({ gpuGroup: 'g' }));
  vi.mocked(redis.hgetall).mockResolvedValueOnce({
    w: JSON.stringify({ gpuGroup: 'g', status: 'BUSY' }),
    sibling: JSON.stringify({ gpuGroup: 'g', status: 'BUSY' }),
    other: JSON.stringify({ gpuGroup: 'other', status: 'BUSY' }),
  });
  try {
    const waiting = observeCompletion(
      redis,
      worker(),
      'tryon',
      'template:1',
      graph,
      log,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 3_100));
        return result;
      },
    );
    await vi.advanceTimersByTimeAsync(3_100);
    await waiting;
    expect(redis.hgetall).toHaveBeenCalledOnce();
    expect(redis.hmget).toHaveBeenCalledTimes(4);
    expect(redis.hmget).toHaveBeenCalledWith('worker:registry', 'sibling');
  } finally {
    vi.useRealTimers();
  }
});
