import type { Logger } from '@aivastra/logger';
import { workerReleaseFailuresTotal } from '@aivastra/observability';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { REGISTRY_KEY, releaseWorker, setWorkerStatus, type WorkerEntry } from './registry.js';

function makeFakeRedis(initial: Record<string, WorkerEntry>) {
  const store = new Map(Object.entries(initial).map(([id, entry]) => [id, JSON.stringify(entry)]));
  return {
    async hgetall(key: string) {
      if (key !== REGISTRY_KEY) return {};
      return Object.fromEntries(store);
    },
    async hset(key: string, id: string, json: string) {
      if (key !== REGISTRY_KEY) throw new Error(`unexpected hset key ${key}`);
      store.set(id, json);
    },
    _entry(id: string): WorkerEntry {
      // biome-ignore lint/style/noNonNullAssertion: test helper, caller controls fixture
      return JSON.parse(store.get(id)!) as WorkerEntry;
    },
  };
}

describe('setWorkerStatus', () => {
  it('does not resurrect a worker an admin drained mid-job back to IDLE', async () => {
    const redis = makeFakeRedis({
      w1: {
        url: 'https://w1.example',
        apiKey: 'k',
        status: 'DRAINING',
        lastSeen: 0,
        allowedJobTypes: [],
      },
    });

    // Job release path calling setWorkerStatus(..., 'IDLE') after admin
    // flipped isActive:false while the worker was mid-job.
    await setWorkerStatus(redis as unknown as Redis, 'w1', 'IDLE');

    expect(redis._entry('w1').status).toBe('DRAINING');
  });

  it('still transitions a non-draining worker to IDLE on job release', async () => {
    const redis = makeFakeRedis({
      w1: {
        url: 'https://w1.example',
        apiKey: 'k',
        status: 'BUSY',
        lastSeen: 0,
        allowedJobTypes: [],
      },
    });

    await setWorkerStatus(redis as unknown as Redis, 'w1', 'IDLE');

    expect(redis._entry('w1').status).toBe('IDLE');
  });
});

describe('bounded atomic worker release', () => {
  it('retries a transient Redis failure without replacing the whole registry entry', async () => {
    const evalCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValue(1);
    const log = { error: vi.fn() } as unknown as Logger;
    await releaseWorker({ eval: evalCommand } as unknown as Redis, 'w', log);
    expect(evalCommand).toHaveBeenCalledTimes(2);
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("val.status ~= 'BUSY'"),
      1,
      REGISTRY_KEY,
      'w',
      expect.any(String),
    );
    expect(log.error).not.toHaveBeenCalled();
  });
  it('two hung attempts are bounded and counted; terminal/refund policy can continue', async () => {
    vi.useFakeTimers();
    try {
      const before = (await workerReleaseFailuresTotal.get()).values[0]?.value ?? 0;
      const evalCommand = vi.fn(() => new Promise(() => {}));
      const log = { error: vi.fn() } as unknown as Logger;
      const release = releaseWorker({ eval: evalCommand } as unknown as Redis, 'w', log);
      await vi.advanceTimersByTimeAsync(10_000);
      await release;
      expect(evalCommand).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledOnce();
      expect((await workerReleaseFailuresTotal.get()).values[0]?.value).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
