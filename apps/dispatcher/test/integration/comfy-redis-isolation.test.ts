import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Logger } from '@aivastra/logger';
import { comfyVersionMismatch } from '@aivastra/observability';
import { capabilitiesKey, comfyVersionKey } from '@aivastra/types';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelPrompt, JobCancelledError } from '../../src/comfyui/cancel.js';
import { COMFY_TIMEOUT_CONFIG_KEY, getComfyTimeoutConfig } from '../../src/config/comfy-timeout.js';
import { makeComfyRedis } from '../../src/lib/redis.js';
import {
  detectCapabilityDrift,
  readCapabilities,
  versionMatches,
} from '../../src/worker/capabilities.js';
import { startHealthMonitor } from '../../src/worker/health-monitor.js';
import {
  healthKey,
  isQueueGateEnabled,
  REGISTRY_KEY,
  routingConfigKey,
} from '../../src/worker/registry.js';

let main: Redis;
let comfyRedis: Redis;
let prefix: string;
let blocked: Promise<unknown>;
let stopMonitor: (() => void) | undefined;
const workerId = 'configured';
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const capabilities = {
  queuePromptIdentityValidated: true,
  queueDeleteValidated: true,
  promptScopedInterruptValidated: true,
  validatedComfyVersion: '0.37.0',
  validatedAt: '2026-10-02',
  validationReference: 'local-mock-only',
};

async function until(check: () => Promise<boolean>) {
  const deadline = performance.now() + 1_000;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  prefix = `comfy-nonblocking:${randomUUID()}:`;
  // Both sockets target local docker-compose Redis; only main carries BLOCK.
  main = new Redis('redis://127.0.0.1:6379', { keyPrefix: prefix });
  comfyRedis = makeComfyRedis(main);
  await Promise.all([main.ping(), comfyRedis.connect()]);
  await comfyRedis.set(capabilitiesKey(workerId), JSON.stringify(capabilities));
  await comfyRedis.set(comfyVersionKey(workerId), '0.37.0');
  await comfyRedis.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 900_000 }));
  await comfyRedis.set(routingConfigKey(workerId), JSON.stringify({ queueGateEnabled: true }));
  await comfyRedis.hset(
    REGISTRY_KEY,
    workerId,
    JSON.stringify({ url: 'http://local.test', apiKey: 'test-key', status: 'IDLE' }),
  );
  // ioredis does not apply keyPrefix to XGROUP's subcommand key.
  await main.xgroup('CREATE', `${prefix}empty-stream`, 'test-group', '0', 'MKSTREAM');
  const id = String(await main.client('ID'));
  blocked = main.xreadgroup(
    'GROUP',
    'test-group',
    'test-consumer',
    'BLOCK',
    2_000,
    'STREAMS',
    'empty-stream',
    '>',
  );
  // Server acknowledgement avoids a timing guess about whether BLOCK has parked.
  await until(async () =>
    String(await comfyRedis.client('LIST'))
      .split('\n')
      .some(
        (line) =>
          line.startsWith(`id=${id} `) &&
          /flags=\S*b/.test(line) &&
          line.includes('cmd=xreadgroup'),
      ),
  );
});

afterEach(async () => {
  stopMonitor?.();
  stopMonitor = undefined;
  vi.unstubAllGlobals();
  await blocked;
  const keys = [
    capabilitiesKey(workerId),
    comfyVersionKey(workerId),
    COMFY_TIMEOUT_CONFIG_KEY,
    routingConfigKey(workerId),
    REGISTRY_KEY,
    healthKey(workerId),
    `worker:queue:${workerId}`,
    'empty-stream',
  ];
  await comfyRedis.del(...keys);
  main.disconnect();
  comfyRedis.disconnect();
});

it('capability/config/version/gate and drift reads finish below 200ms while main is blocked for 2s', async () => {
  let mainReadFinished = false;
  const mainRead = main.get(capabilitiesKey(workerId)).then(() => {
    mainReadFinished = true;
  });
  const before = await comfyVersionMismatch.get();
  const started = performance.now();
  const read = await readCapabilities(comfyRedis, workerId, 'submission', 5_000, log);
  expect(read.status).toBe('configured');
  expect((await getComfyTimeoutConfig(comfyRedis)).config.maxQueueWaitMs).toBe(900_000);
  expect(await versionMatches(comfyRedis, workerId, read, 5_000, log)).toBe(true);
  expect(await isQueueGateEnabled(comfyRedis, workerId)).toBe(true);
  await detectCapabilityDrift(comfyRedis, workerId, log as unknown as Logger);
  expect(performance.now() - started).toBeLessThan(200);
  expect(mainReadFinished).toBe(false);
  expect(log.error).not.toHaveBeenCalled();
  expect((await comfyVersionMismatch.get()).values).toEqual(before.values);
  await mainRead;
});

it('monitor renews version/health without false drift errors while main is blocked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        system: { comfyui_version: '0.37.0' },
        queue_running: [],
        queue_pending: [],
      }),
    })),
  );
  const started = performance.now();
  stopMonitor = startHealthMonitor(comfyRedis, log as unknown as Logger);
  await until(
    async () =>
      (await comfyRedis.get(healthKey(workerId))) === '1' &&
      (await comfyRedis.ttl(comfyVersionKey(workerId))) > 0 &&
      (await comfyRedis.get(`worker:queue:${workerId}`)) !== null,
  );
  // Queue snapshots are written after drift detection, so diagnostics have finished.
  expect(performance.now() - started).toBeLessThan(200);
  expect(log.error).not.toHaveBeenCalled();
});

it('cancel live authorization uses the non-blocking context', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/history/') ? { ours: {} } : {}),
    })),
  );
  const { config } = await getComfyTimeoutConfig(comfyRedis);
  const started = performance.now();
  await expect(
    cancelPrompt(
      'http://local.test',
      'test-key',
      'ours',
      false,
      config,
      { comfyRedis, workerId },
      log,
    ),
  ).rejects.toBeInstanceOf(JobCancelledError);
  expect(performance.now() - started).toBeLessThan(200);
  expect(log.error).not.toHaveBeenCalled();
});

it('rejects offline authorization reads immediately instead of queueing for reconnect', async () => {
  comfyRedis.disconnect();
  await until(async () => comfyRedis.status === 'end');
  const started = performance.now();
  try {
    await expect(comfyRedis.get(capabilitiesKey(workerId))).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(200);
  } finally {
    await comfyRedis.connect();
  }
});
