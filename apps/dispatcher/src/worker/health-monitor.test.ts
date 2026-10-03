import type { Logger } from '@aivastra/logger';
import { capabilitiesKey, comfyVersionKey } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { afterEach, expect, it, vi } from 'vitest';
import { startHealthMonitor } from './health-monitor.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('draining workers retain a fresh version but never renew routing health', async () => {
  vi.useFakeTimers();
  const redis = {
    hgetall: vi.fn(async () => ({
      w: JSON.stringify({ url: 'http://local.test', apiKey: 'test-key', status: 'DRAINING' }),
    })),
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    xlen: vi.fn(async () => 0),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ system: { comfyui_version: '0.37.0' } }),
    })),
  );
  const stop = startHealthMonitor(redis as unknown as Redis, log);
  await vi.advanceTimersByTimeAsync(1);
  stop();
  expect(redis.setex).toHaveBeenCalledWith(comfyVersionKey('w'), 60, '0.37.0');
  expect(redis.setex).not.toHaveBeenCalledWith(
    'worker:health:w',
    expect.anything(),
    expect.anything(),
  );
  expect(redis.get).toHaveBeenCalledWith(capabilitiesKey('w'));
});
it('gate drift is detected even without global budgets', async () => {
  vi.useFakeTimers();
  vi.mocked(log.error).mockClear();
  const redis = {
    hgetall: vi.fn(async () => ({
      w: JSON.stringify({ url: 'http://local.test', apiKey: 'test-key', status: 'DRAINING' }),
    })),
    setex: vi.fn(async () => 'OK'),
    xlen: vi.fn(async () => 0),
    get: vi.fn(async (key: string) =>
      key === capabilitiesKey('w')
        ? JSON.stringify({
            queuePromptIdentityValidated: true,
            validatedComfyVersion: '0.37.0',
            validatedAt: '2026-10-01',
          })
        : key === comfyVersionKey('w')
          ? '0.37.0'
          : null,
    ),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ system: { comfyui_version: '0.37.0' } }),
    })),
  );
  const stop = startHealthMonitor(redis as unknown as Redis, log);
  await vi.advanceTimersByTimeAsync(1);
  stop();
  expect(log.error).toHaveBeenCalledWith(
    { workerId: 'w' },
    'configured worker lacks queue gate protection',
  );
});

it('an unreadable stats body does not change HTTP-success routing health', async () => {
  vi.useFakeTimers();
  const redis = {
    hgetall: vi.fn(async () => ({
      w: JSON.stringify({ url: 'http://local.test', apiKey: 'test-key', status: 'IDLE' }),
    })),
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    xlen: vi.fn(async () => 0),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid JSON');
      },
    })),
  );
  const stop = startHealthMonitor(redis as unknown as Redis, log);
  await vi.advanceTimersByTimeAsync(1);
  stop();
  expect(redis.setex).toHaveBeenCalledWith('worker:health:w', 30, '1');
  expect(redis.setex).not.toHaveBeenCalledWith(
    comfyVersionKey('w'),
    expect.anything(),
    expect.anything(),
  );
});

it('slow draining probes do not delay healthy workers later in registry order', async () => {
  vi.useFakeTimers();
  const redis = {
    hgetall: vi.fn(async () =>
      Object.fromEntries(
        ['slow-1', 'slow-2', 'healthy'].map((id) => [
          id,
          JSON.stringify({
            url: `http://${id}.test`,
            apiKey: 'test-key',
            status: id === 'healthy' ? 'IDLE' : 'DRAINING',
          }),
        ]),
      ),
    ),
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    xlen: vi.fn(async () => 0),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('slow-')) await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { ok: true, json: async () => ({}) };
    }),
  );
  const stop = startHealthMonitor(redis as unknown as Redis, log);
  await vi.advanceTimersByTimeAsync(1);
  expect(redis.setex).toHaveBeenCalledWith('worker:health:healthy', 30, '1');
  expect(redis.setex).not.toHaveBeenCalledWith('worker:health:slow-1', 30, '1');
  await vi.advanceTimersByTimeAsync(5_000);
  stop();
});
