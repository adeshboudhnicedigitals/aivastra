import { readdirSync, readFileSync } from 'node:fs';
import { capabilitiesKey, comfyVersionKey } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMFY_TIMEOUT_CONFIG_KEY } from '../config/comfy-timeout.js';
import { handleCompletionResult } from './completion-result.js';
import { JobCancelledError, waitForCompletion } from './progress.js';

const capabilities = {
  queuePromptIdentityValidated: true,
  queueDeleteValidated: true,
  promptScopedInterruptValidated: true,
  validatedComfyVersion: '0.37.0',
  validatedAt: '2026-10-01',
  validationReference: 'two-prompts-local-test',
};
let store: Map<string, string>;
let get: ReturnType<typeof vi.fn>;
let calls: Array<{ path: string; body?: Record<string, unknown>; at: number }>;
let queue: (at: number) => 'pending' | 'running' | 'absent' | 'failure';
let history: (at: number) => Record<string, unknown>;
let cancel: () => Promise<boolean>;
let onRequest: (path: string, body?: Record<string, unknown>) => void;
let deleteFails: boolean;
let interruptFails: boolean;
let hangPath: string | undefined;
const log = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
const response = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
  text: async () => 'mock error',
});

function wait(timeoutMs = 300_000, totalNodeCount = 0) {
  return waitForCompletion(
    'http://local.test',
    'test-key',
    'client',
    'ours',
    timeoutMs,
    undefined,
    log,
    cancel,
    { comfyRedis: { get } as unknown as Redis, workerId: 'w' },
    totalNodeCount,
  );
}
async function settle<T>(promise: Promise<T>, advanceMs = 1_000_000) {
  const result = promise.then(
    (value) => ({ value, error: undefined }),
    (error: Error) => ({ value: undefined, error }),
  );
  await vi.advanceTimersByTimeAsync(advanceMs);
  return result;
}
function enable() {
  store.set(capabilitiesKey('w'), JSON.stringify(capabilities));
  store.set(comfyVersionKey('w'), '0.37.0');
  store.set('worker:routing-config:w', JSON.stringify({ queueGateEnabled: true }));
  store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 900_000 }));
}
const outputs = { ours: { outputs: { '1': {} } } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  vi.setSystemTime(0);
  vi.clearAllMocks();
  store = new Map();
  get = vi.fn(async (key: string) => store.get(key) ?? null);
  calls = [];
  queue = () => 'pending';
  history = () => ({});
  cancel = async () => false;
  onRequest = () => {};
  deleteFails = false;
  interruptFails = false;
  hangPath = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, body, at: Date.now() });
      onRequest(path, body);
      if (path === hangPath) {
        return new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('request timed out')),
            path === '/history/ours' ? 20_000 : 5_000,
          );
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
      }
      if (init?.method === 'POST')
        return response({}, path === '/queue' ? !deleteFails : !interruptFails);
      if (path === '/history/ours') return response(history(Date.now()));
      if (path === '/queue') {
        const state = queue(Date.now());
        return response(
          {
            queue_running: state === 'running' ? [[0, 'ours']] : [[1, 'foreign']],
            queue_pending: state === 'pending' ? [[0, 'ours']] : [],
          },
          state !== 'failure',
        );
      }
      throw new Error(`Unexpected request ${path}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('execution clock and Stage 1 queue exhaustion', () => {
  it('queued 400s then running 100s completes with a 300s execution budget', async () => {
    enable();
    queue = (at) => (at < 400_000 ? 'pending' : 'running');
    history = (at) => (at >= 500_000 ? outputs : {});
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.filter((c) => c.path === '/queue').at(-1)?.at).toBe(402_000);
  });
  it('never starts: attempts bounded scoped cleanup before returning cleanup_failed', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 10_000 }));
    expect((await settle(wait())).value).toEqual({ status: 'queue_cleanup_failed' });
    expect(calls.at(-1)?.at).toBeLessThanOrEqual(42_000);
    expect(calls.some((c) => c.body?.delete)).toBe(true);
    expect(calls.some((c) => c.path === '/interrupt')).toBe(false);
  });
  it('accepts outputs that arrive in the final queue poll interval', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1_000 }));
    history = () => outputs;
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.some((c) => c.body)).toBe(false);
  });
  it('does not delete a prompt that starts during exhaustion reconciliation', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1_000 }));
    queue = () => 'running';
    history = (at) => (at >= 6_000 ? outputs : {});
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.some((c) => c.body)).toBe(false);
  });
  it('rechecks authorization before each cleanup delete', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1_000 }));
    onRequest = (_path, body) => {
      if (body?.delete)
        store.set(
          capabilitiesKey('w'),
          JSON.stringify({ ...capabilities, queueDeleteValidated: false }),
        );
    };
    expect((await settle(wait())).value).toEqual({ status: 'queue_cleanup_failed' });
    expect(calls.filter((c) => c.body?.delete)).toHaveLength(1);
  });
  it('confirms deletion without touching the foreign running prompt', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1_000 }));
    onRequest = (_path, body) => {
      if (body?.delete) queue = () => 'absent';
    };
    expect((await settle(wait())).value).toEqual({ status: 'queue_cleanup_failed' });
    expect(calls.filter((c) => c.body?.delete)).toHaveLength(1);
    expect(calls.some((c) => c.path === '/interrupt')).toBe(false);
    expect(calls.at(-1)?.path).toBe('/history/ours');
  });
  it('cleanup history failures stay bounded and do not escape into workflow retry', async () => {
    enable();
    store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1_000 }));
    hangPath = '/history/ours';
    const result = await settle(wait());
    expect(result.value).toEqual({ status: 'queue_cleanup_failed' });
    expect(calls.some((c) => c.body)).toBe(false);
    expect(calls.at(-1)?.at).toBeLessThan(38_000);
  });
  it('execution timeout is measured from first observed running and keeps its message', async () => {
    enable();
    queue = (at) => (at < 12_000 ? 'pending' : 'running');
    const result = await settle(wait(6_000));
    expect(result.error?.message).toBe(
      'ComfyUI history polling timeout after 6000ms for prompt ours',
    );
    expect(calls.at(-1)?.at).toBe(21_000);
    expect(calls.filter((c) => c.path === '/queue').at(-1)?.at).toBe(12_000);
  });
  it('queued 250s then running ignores all subsequent queue failures', async () => {
    enable();
    queue = (at) => (at < 250_000 ? 'pending' : at <= 252_000 ? 'running' : 'failure');
    history = (at) => (at >= 540_000 ? outputs : {});
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.filter((c) => c.path === '/queue').at(-1)?.at).toBe(252_000);
  });
  it('a vanished RUNNING prompt waits until its execution deadline', async () => {
    enable();
    queue = (at) => (at <= 3_000 ? 'running' : 'absent');
    expect((await settle(wait(9_000))).error).toBeDefined();
    expect(calls.filter((c) => c.path === '/queue')).toHaveLength(1);
  });
  it('finished between polls completes without observing running', async () => {
    enable();
    history = () => outputs;
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.filter((c) => c.path === '/queue')).toHaveLength(0);
  });
  it('execution error retains node and exception details', async () => {
    enable();
    history = () => ({
      ours: {
        status: {
          status_str: 'error',
          messages: [
            [
              'execution_error',
              { node_type: 'SaveImage', node_id: '10', exception_message: 'missing input' },
            ],
          ],
        },
      },
    });
    expect((await settle(wait())).error?.message).toBe(
      'ComfyUI execution error for prompt ours: SaveImage (node 10): missing input',
    );
  });
  it('history transport failures still escape (pre-existing behavior)', async () => {
    enable();
    hangPath = '/history/ours';
    expect((await settle(wait())).error?.message).toBe('aborted');
  });
  it('snapshots budgets at submission', async () => {
    enable();
    onRequest = () => store.set(COMFY_TIMEOUT_CONFIG_KEY, JSON.stringify({ maxQueueWaitMs: 1 }));
    history = (at) => (at >= 12_000 ? outputs : {});
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
  });
});

describe('legacy and unknown observations', () => {
  it.each([
    'budget_unset',
    'budget_invalid',
    'capability_missing',
    'capability_unreadable',
    'identity_false',
    'delete_false',
    'gate_off',
    'gate_missing',
    'version_missing',
    'version_changed',
  ])('%s starts LEGACY without queue polling', async (reason) => {
    enable();
    if (reason === 'budget_unset') store.delete(COMFY_TIMEOUT_CONFIG_KEY);
    if (reason === 'budget_invalid') store.set(COMFY_TIMEOUT_CONFIG_KEY, '{');
    if (reason === 'capability_missing') store.delete(capabilitiesKey('w'));
    if (reason === 'capability_unreadable') store.set(capabilitiesKey('w'), '{');
    if (reason === 'identity_false' || reason === 'delete_false')
      store.set(
        capabilitiesKey('w'),
        JSON.stringify({
          ...capabilities,
          [reason === 'identity_false' ? 'queuePromptIdentityValidated' : 'queueDeleteValidated']:
            false,
        }),
      );
    if (reason === 'gate_off') store.set('worker:routing-config:w', '{"queueGateEnabled":false}');
    if (reason === 'gate_missing') store.delete('worker:routing-config:w');
    if (reason === 'version_missing') store.delete(comfyVersionKey('w'));
    if (reason === 'version_changed') store.set(comfyVersionKey('w'), 'new-version');
    expect((await settle(wait(6_000))).error).toBeDefined();
    expect(calls.filter((c) => c.path === '/queue')).toHaveLength(0);
    expect(calls.at(-1)?.at).toBe(6_000);
  });
  it('three queue failures enter sticky mid-flight fallback with a full timeout', async () => {
    enable();
    queue = () => 'failure';
    expect((await settle(wait(6_000))).error).toBeDefined();
    expect(calls.filter((c) => c.path === '/queue')).toHaveLength(3);
    expect(calls.at(-1)?.at).toBe(15_000);
  });
  it('queued 250s before fallback gets 300s after fallback, rather than submission', async () => {
    enable();
    queue = (at) => (at < 250_000 ? 'pending' : 'failure');
    history = (at) => (at >= 540_000 ? outputs : {});
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(calls.filter((c) => c.path === '/queue').at(-1)?.at).toBe(258_000);
  });
  it('one queue failure is transient and a successful read resets error count', async () => {
    enable();
    queue = (at) => (at === 3_000 || at === 9_000 ? 'failure' : 'pending');
    history = (at) => (at >= 15_000 ? outputs : {});
    expect((await settle(wait(3_000))).value).toEqual({ status: 'completed' });
    expect(log.warn).not.toHaveBeenCalled();
  });
  it('unknown-state grace expires into sticky fallback', async () => {
    enable();
    queue = () => 'absent';
    expect((await settle(wait(3_000))).error).toBeDefined();
    expect(calls.filter((c) => c.path === '/queue').at(-1)?.at).toBe(15_000);
    expect(calls.at(-1)?.at).toBe(18_000);
  });
  it('known pending resets the unknown grace timer', async () => {
    enable();
    queue = (at) => ([6_000, 12_000].includes(at) ? 'pending' : 'absent');
    history = (at) => (at >= 21_000 ? outputs : {});
    expect((await settle(wait(3_000))).value).toEqual({ status: 'completed' });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('cancellation live authorization and ratchet', () => {
  it('never-configured start and cancel uses freshly authorized legacy interrupt', async () => {
    cancel = async () => true;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toEqual([{ path: '/interrupt', body: undefined, at: 3_000 }]);
  });
  it('LEGACY decision is denied if capabilities appear immediately before interrupt', async () => {
    let reads = 0;
    get.mockImplementation(async (key: string) =>
      key === capabilitiesKey('w') && ++reads >= 3
        ? JSON.stringify(capabilities)
        : (store.get(key) ?? null),
    );
    cancel = async () => true;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
  });
  it.each([
    'configured_lost',
    'unreadable_lost',
    'version_missing',
    'version_changed',
    'partial',
    'malformed',
    'redis_failure',
  ])('%s cancellation is conservative with zero ComfyUI calls', async (scenario) => {
    enable();
    if (scenario === 'unreadable_lost') store.set(capabilitiesKey('w'), '{');
    cancel = async () => {
      if (scenario.endsWith('_lost')) store.delete(capabilitiesKey('w'));
      if (scenario === 'version_missing') store.delete(comfyVersionKey('w'));
      if (scenario === 'version_changed') store.set(comfyVersionKey('w'), 'changed');
      if (scenario === 'partial')
        store.set(
          capabilitiesKey('w'),
          JSON.stringify({ ...capabilities, queueDeleteValidated: false }),
        );
      if (scenario === 'malformed') store.set(capabilitiesKey('w'), '[]');
      if (scenario === 'redis_failure') get.mockRejectedValue(new Error('Redis unavailable'));
      return true;
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
  });
  it.each([
    'pending',
    'running',
    'completed',
  ])('SAFE_SCOPED cancel %s confirms with scoped calls only, without gate or budgets', async (state) => {
    enable();
    store.delete('worker:routing-config:w');
    store.delete(COMFY_TIMEOUT_CONFIG_KEY);
    cancel = async () => true;
    queue = () => (state === 'pending' ? 'absent' : 'running');
    history = () =>
      state === 'pending'
        ? {}
        : { ours: { status: { status_str: state === 'completed' ? 'success' : 'error' } } };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.filter((c) => c.body).map((c) => c.body)).toEqual([
      { delete: ['ours'] },
      { prompt_id: 'ours' },
    ]);
  });
  it('not configured at start, validated at cancel uses current safe scoped mode', async () => {
    cancel = async () => {
      enable();
      return true;
    };
    history = () => outputs;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls[1]?.body).toEqual({ prompt_id: 'ours' });
  });
  it('capability revoked before first delete suppresses both operations', async () => {
    enable();
    let reads = 0;
    get.mockImplementation(async (key: string) => {
      if (key === capabilitiesKey('w') && ++reads >= 3)
        return JSON.stringify({ ...capabilities, queueDeleteValidated: false });
      return store.get(key) ?? null;
    });
    cancel = async () => true;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
  });
  it('revocation between delete and interrupt skips interrupt and runs confirmation', async () => {
    enable();
    cancel = async () => true;
    queue = () => 'running';
    onRequest = (path, body) => {
      if (path === '/queue' && body)
        store.set(
          capabilitiesKey('w'),
          JSON.stringify({ ...capabilities, promptScopedInterruptValidated: false }),
        );
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.filter((c) => c.path === '/interrupt')).toHaveLength(0);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel_mode: 'safe_scoped',
        cancel_outcome: 'authorization_weakened',
      }),
      expect.any(String),
    );
  });
  it.each([
    'delete',
    'interrupt',
  ])('%s HTTP failure still ends with cancellation and confirmation', async (operation) => {
    enable();
    cancel = async () => true;
    deleteFails = operation === 'delete';
    interruptFails = operation === 'interrupt';
    history = () => outputs;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.some((c) => c.path === '/interrupt')).toBe(true);
  });
  it('failed pending delete retries with authorization and then confirms absence', async () => {
    enable();
    cancel = async () => true;
    let deletes = 0;
    queue = () => (deletes < 2 ? 'pending' : 'absent');
    onRequest = (path, body) => {
      if (path === '/queue' && body) deleteFails = ++deletes === 1;
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(deletes).toBe(2);
  });
  it('revocation before a pending-delete retry prevents retry', async () => {
    enable();
    cancel = async () => true;
    deleteFails = true;
    onRequest = (path, body) => {
      if (path === '/interrupt' && body)
        store.set(
          capabilitiesKey('w'),
          JSON.stringify({ ...capabilities, queueDeleteValidated: false }),
        );
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.filter((c) => c.path === '/queue' && c.body)).toHaveLength(1);
  });
  it('one absence followed by presence is not resolved', async () => {
    enable();
    cancel = async () => true;
    queue = (at) => (at === 3_000 ? 'absent' : 'running');
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_outcome: 'unconfirmed' }),
      expect.any(String),
    );
  });
  it('queue unreadable can resolve through interrupted history', async () => {
    enable();
    cancel = async () => true;
    queue = () => 'failure';
    history = (at) => (at >= 5_000 ? { ours: { status: { status_str: 'error' } } } : {});
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ cancel_outcome: 'confirmed' }),
      expect.any(String),
    );
  });
  it('unreadable queue and empty history expires unconfirmed', async () => {
    enable();
    cancel = async () => true;
    queue = () => 'failure';
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.at(-1)?.at).toBeLessThan(23_000);
  });
  it.each([
    '/queue',
    '/interrupt',
    '/history/ours',
  ])('hanging %s cancel requests stop at the outer deadline', async (path) => {
    enable();
    cancel = async () => true;
    hangPath = path;
    const promise = wait();
    const result = promise.catch((error: Error) => ({ error, endedAt: Date.now() }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(((await result) as { error: Error }).error).toBeInstanceOf(JobCancelledError);
    expect(((await result) as { endedAt: number }).endedAt).toBeLessThanOrEqual(23_000);
    expect(calls.every((c) => c.at < 23_000)).toBe(true);
  });
  it('two sequential hanging destructive calls cannot extend a short cancellation deadline', async () => {
    enable();
    store.set(
      COMFY_TIMEOUT_CONFIG_KEY,
      JSON.stringify({ maxQueueWaitMs: 900_000, cancelConfirmationTimeoutMs: 6_000 }),
    );
    cancel = async () => true;
    onRequest = (path, body) => {
      if (body && (path === '/queue' || path === '/interrupt')) hangPath = path;
    };
    const result = wait().catch((error: Error) => ({ error, endedAt: Date.now() }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(((await result) as { error: Error }).error).toBeInstanceOf(JobCancelledError);
    expect(((await result) as { endedAt: number }).endedAt).toBe(9_000);
    expect(calls.map((c) => c.path)).toEqual(['/queue', '/interrupt']);
  });
  it.each([
    '/queue',
    '/interrupt',
  ])('%s network failure still ends as cancellation', async (operation) => {
    enable();
    cancel = async () => true;
    history = () => outputs;
    onRequest = (path, body) => {
      if (path === operation && body) throw new Error('network failure');
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls.some((c) => c.path === '/interrupt')).toBe(true);
  });
  it('LEGACY fresh authorization unreadable or hung is never permission to interrupt', async () => {
    let reads = 0;
    get.mockImplementation(async (key: string) => {
      if (key === capabilitiesKey('w') && ++reads === 3) return new Promise(() => {});
      return store.get(key) ?? null;
    });
    cancel = async () => true;
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
  });
  it('version authorization hangs near the deadline: skipped interrupt never runs late', async () => {
    enable();
    store.set(
      COMFY_TIMEOUT_CONFIG_KEY,
      JSON.stringify({ maxQueueWaitMs: 900_000, cancelConfirmationTimeoutMs: 6_000 }),
    );
    cancel = async () => true;
    onRequest = (path, body) => {
      if (path === '/queue' && body) {
        const previous = get.getMockImplementation();
        get.mockImplementation((key: string) =>
          key === comfyVersionKey('w') ? new Promise(() => {}) : previous?.(key),
        );
      }
    };
    const result = wait().catch((error: Error) => ({ error, endedAt: Date.now() }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(((await result) as { error: Error }).error).toBeInstanceOf(JobCancelledError);
    expect(((await result) as { endedAt: number }).endedAt).toBeLessThanOrEqual(9_000);
    expect(calls.some((c) => c.path === '/interrupt')).toBe(false);
  });
  it('hanging live authorization is bounded by cancel deadline and never interrupts', async () => {
    enable();
    cancel = async () => {
      get.mockImplementation(() => new Promise(() => {}));
      return true;
    };
    expect((await settle(wait())).error).toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
  });
});

describe('typed caller enforcement', () => {
  it('completed continues and cleanup_failed always terminates before output handling', async () => {
    const terminal = vi.fn(async () => {});
    expect(await handleCompletionResult({ status: 'completed' }, terminal)).toBe(false);
    expect(terminal).not.toHaveBeenCalled();
    expect(await handleCompletionResult({ status: 'queue_cleanup_failed' }, terminal)).toBe(true);
    expect(terminal).toHaveBeenCalledOnce();
  });
  it('no production file contains a bare await waitForCompletion', () => {
    const root = new URL('../', import.meta.url);
    for (const path of readdirSync(root, { recursive: true }) as string[]) {
      if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
      expect(readFileSync(new URL(path, root), 'utf8'), path).not.toMatch(
        /^\s*await waitForCompletion\(/m,
      );
    }
  });
  it('all production call sites consume completion results before output-fetch; no bare await', () => {
    for (const file of ['processor', 'mannequin-phase']) {
      const source = readFileSync(new URL(`../job/${file}.ts`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/^\s*await waitForCompletion\(/m);
      const sites =
        source.match(
          /const completion = await (?:waitForCompletion|observeCompletion)\([\s\S]*?fetchHistory\(/g,
        ) ?? [];
      expect(sites).toHaveLength(file === 'processor' ? 7 : 1);
      expect(source.match(/settlePerformanceSample\(w, 'success'\)/g)).toHaveLength(
        file === 'processor' ? 7 : 1,
      );
      expect(source.match(/selectWorker\(redis, WORKER_POOL\.\w+, performanceKey\)/g)).toHaveLength(
        file === 'processor' ? 7 : 1,
      );
      for (const site of sites)
        expect(site).toMatch(
          file === 'processor'
            ? /handleCompletionResult\(completion,[\s\S]*?return;/
            : /switch \(completion.status\)[\s\S]*?cleanup_failed[\s\S]*?assertNever/,
        );
    }
  });
});

describe('completion timing at every return point', () => {
  const timed = {
    ours: {
      outputs: { '1': {} },
      status: {
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_cached', { nodes: ['1'] }],
          ['execution_success', { timestamp: 4000 }],
        ],
      },
    },
  };
  it.each(['normal', 'reconcile', 'final'] as const)('%s returns worker timing', async (point) => {
    enable();
    let reads = 0;
    if (point !== 'normal') {
      store.set(
        COMFY_TIMEOUT_CONFIG_KEY,
        JSON.stringify({ maxQueueWaitMs: 1, queueStateUnknownGraceMs: 1 }),
      );
      queue = () => 'absent';
    }
    history = () =>
      ++reads >= (point === 'normal' ? 1 : point === 'reconcile' ? 2 : 4) ? timed : {};
    const result = await settle(wait(300_000, 5));
    expect(result.error).toBeUndefined();
    expect(reads).toBe(point === 'normal' ? 1 : point === 'reconcile' ? 2 : 4);
    expect(calls.filter((call) => call.path === '/queue')).toHaveLength(point === 'final' ? 2 : 0);
    expect(result.value).toEqual({
      status: 'completed',
      executionTiming: {
        executionStartMs: 1000,
        executionSuccessMs: 4000,
        cachedNodeCount: 1,
        totalNodeCount: 5,
      },
    });
  });
  it.each(['normal', 'reconcile', 'final'] as const)('%s omits missing timing', async (point) => {
    enable();
    let reads = 0;
    if (point !== 'normal') {
      store.set(
        COMFY_TIMEOUT_CONFIG_KEY,
        JSON.stringify({ maxQueueWaitMs: 1, queueStateUnknownGraceMs: 1 }),
      );
      queue = () => 'absent';
    }
    history = () =>
      ++reads >= (point === 'normal' ? 1 : point === 'reconcile' ? 2 : 4) ? outputs : {};
    expect((await settle(wait())).value).toEqual({ status: 'completed' });
    expect(reads).toBe(point === 'normal' ? 1 : point === 'reconcile' ? 2 : 4);
    expect(calls.filter((call) => call.path === '/queue')).toHaveLength(point === 'final' ? 2 : 0);
  });
});
