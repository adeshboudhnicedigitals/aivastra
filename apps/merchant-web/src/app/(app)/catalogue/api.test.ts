import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/errors';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: { get } }));

import type { JobStatusEvent } from '@/components/job-stream-provider';
import { waitForGenerateJob } from './api';

type Listener = (evt: JobStatusEvent) => void;

function makeStream() {
  let listener: Listener | null = null;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((fn: Listener) => {
    listener = fn;
    return unsubscribe;
  });
  const emit = (status: string, jobId = 'job-1') =>
    listener?.({ jobId, userId: 'owner', type: 'STATUS', status });
  return { subscribe, unsubscribe, emit };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const tick = () => vi.advanceTimersByTimeAsync(3_000);

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('waitForGenerateJob', () => {
  it('resolves via polling when the stream never emits (staff case)', async () => {
    const s = makeStream();
    get
      .mockResolvedValueOnce({ status: 'QUEUED' })
      .mockResolvedValueOnce({ status: 'GENERATING' })
      .mockResolvedValueOnce({ status: 'COMPLETED', errorCode: null });
    const onStatus = vi.fn();
    const p = waitForGenerateJob('job-1', s.subscribe, onStatus);
    await flush();
    await tick();
    await tick();
    await expect(p).resolves.toEqual({ status: 'COMPLETED', errorCode: null });
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(['QUEUED', 'GENERATING', 'COMPLETED']);
    expect(get).toHaveBeenCalledWith('/v1/merchant/catalog/generate/job-1');
  });

  it('resolves via the stream when it emits first', async () => {
    const s = makeStream();
    get.mockResolvedValue({ status: 'GENERATING' });
    const p = waitForGenerateJob('job-1', s.subscribe);
    await flush();
    s.emit('FAILED');
    await expect(p).resolves.toEqual({ status: 'FAILED', errorCode: null });
  });

  it('ignores stream events for other jobs', async () => {
    const s = makeStream();
    get.mockResolvedValue({ status: 'GENERATING' });
    let done = false;
    const p = waitForGenerateJob('job-1', s.subscribe).then(() => {
      done = true;
    });
    await flush();
    s.emit('COMPLETED', 'other-job');
    await flush();
    expect(done).toBe(false);
    s.emit('COMPLETED');
    await p;
    expect(done).toBe(true);
  });

  it('rejects after 5 consecutive polling failures', async () => {
    const s = makeStream();
    get.mockRejectedValue(new ApiError(503, null));
    const p = waitForGenerateJob('job-1', s.subscribe);
    const assertion = expect(p).rejects.toThrow();
    await flush();
    for (let i = 0; i < 4; i++) await tick();
    await assertion;
    expect(get).toHaveBeenCalledTimes(5);
    expect(s.unsubscribe).toHaveBeenCalled();
  });

  it('resets the failure counter after a successful poll', async () => {
    const s = makeStream();
    const fail = () => get.mockRejectedValueOnce(new Error('network'));
    for (let i = 0; i < 4; i++) fail();
    get.mockResolvedValueOnce({ status: 'GENERATING' });
    for (let i = 0; i < 4; i++) fail();
    get.mockResolvedValueOnce({ status: 'COMPLETED' });
    const p = waitForGenerateJob('job-1', s.subscribe);
    await flush();
    for (let i = 0; i < 9; i++) await tick();
    await expect(p).resolves.toEqual({ status: 'COMPLETED', errorCode: null });
    expect(get).toHaveBeenCalledTimes(10);
  });

  it('rejects immediately on a permanent 4xx', async () => {
    const s = makeStream();
    get.mockRejectedValue(new ApiError(404, null));
    await expect(
      (async () => {
        const p = waitForGenerateJob('job-1', s.subscribe);
        const a = expect(p).rejects.toBeInstanceOf(ApiError);
        await flush();
        await a;
      })(),
    ).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and stops polling after settle', async () => {
    const s = makeStream();
    get.mockResolvedValue({ status: 'GENERATING' });
    const p = waitForGenerateJob('job-1', s.subscribe);
    await flush();
    s.emit('COMPLETED');
    await p;
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    const calls = get.mock.calls.length;
    await tick();
    await tick();
    expect(get).toHaveBeenCalledTimes(calls);
  });
});
