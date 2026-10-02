import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { getComfyTimeoutConfig } from './comfy-timeout.js';

describe('Stage 1 live timeout config', () => {
  it.each([
    null,
    '{}',
    '{',
    '[]',
    '{"maxQueueWaitMs":0}',
    '{"maxQueueWaitMs":-1}',
    '{"maxQueueWaitMs":"900000"}',
  ])('invalid or unset budget %s disables timeouts but retains engineering defaults', async (raw) => {
    const { config } = await getComfyTimeoutConfig({
      get: vi.fn(async () => raw),
    } as unknown as Redis);
    expect(config.maxQueueWaitMs).toBeUndefined();
    expect(config.queueStateUnknownGraceMs).toBe(10_000);
    expect(config.cancelConfirmationTimeoutMs).toBe(20_000);
  });
  it('only needs a positive queue budget, with no Stage 2 cleanup budget', async () => {
    expect(
      (
        await getComfyTimeoutConfig({
          get: vi.fn(async () => '{"maxQueueWaitMs":900000}'),
        } as unknown as Redis)
      ).config.maxQueueWaitMs,
    ).toBe(900_000);
  });
  it('read errors disable queue-aware timeout', async () => {
    expect(
      (
        await getComfyTimeoutConfig({
          get: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
        } as unknown as Redis)
      ).reason,
    ).toBe('queue_budget_unreadable');
  });
});

it('cleanup budget must cover grace and two poll intervals at the exact boundary', async () => {
  for (const [budget, enabled] of [
    [15_999, false],
    [16_000, true],
  ] as const) {
    const { config } = await getComfyTimeoutConfig({
      get: vi.fn(async () => JSON.stringify({ maxQueueWaitMs: 1, queueCleanupTimeoutMs: budget })),
    } as unknown as Redis);
    expect(config.maxQueueWaitMs !== undefined).toBe(enabled);
  }
});
