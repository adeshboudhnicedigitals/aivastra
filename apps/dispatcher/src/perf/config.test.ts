import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';
import { readPerfConfig } from './config.js';

it.each([
  null,
  '{',
  JSON.stringify({ mode: 'bad' }),
  JSON.stringify({ mode: 'observe', baselineMs: 0 }),
  JSON.stringify({ mode: 'observe', pools: { tryon: 1 } }),
  JSON.stringify({ mode: 'observe', probeBackoffMs: 1000 }),
  JSON.stringify({ mode: 'observe', poolBaselines: { tryon: -1 } }),
  JSON.stringify({ mode: 'observe', cachePolicyFrozen: 'true' }),
])('invalid or missing config fails OFF: %s', async (raw) => {
  expect((await readPerfConfig({ get: async () => raw } as unknown as Redis)).mode).toBe('off');
});
it('accepts per-pool modes and validated defaults', async () => {
  const config = await readPerfConfig({
    get: async () =>
      JSON.stringify({ mode: 'observe', pools: { tryon: 'active' }, cachePolicyFrozen: true }),
  } as unknown as Redis);
  expect(config.pools?.tryon).toBe('active');
  expect(config.baselineMs).toBe(60_000);
  expect(config.alpha).toBe(0.2);
});
