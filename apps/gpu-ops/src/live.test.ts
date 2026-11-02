import { describe, expect, it } from 'vitest';
import { createLiveRepository, FleetLoadError, parseLiveFleet, toSnapshot } from './live';
import { freshness } from './model';

const worker = (over: Record<string, unknown> = {}) => ({
  workerId: 'worker-3',
  label: 'w3',
  dispatcherState: 'IDLE',
  health: 'HEALTHY',
  routing: 'ok',
  active: true,
  inRegistry: true,
  jobTypes: ['catalogue'],
  comfy: {
    reachable: true,
    running: 1,
    pending: 2,
    observedAt: '2026-10-13T11:20:50.000Z',
    stale: false,
  },
  gpu: {
    name: 'Example GPU',
    vramUsedMb: 40960,
    vramTotalMb: 98304,
    observedAt: '2026-10-13T11:20:50.000Z',
    stale: false,
  },
  hostMemory: {
    totalGb: 82.5,
    availableGb: 58.7,
    observedAt: '2026-10-13T11:20:50.000Z',
    stale: false,
  },
  ownership: 'PRODUCTION',
  prompt: { id: 'prompt-1', jobId: 'job-1', observedAt: '2026-10-13T11:20:50.000Z' },
  lastSeenAt: '2026-10-13T10:01:24.000Z',
  warning: null,
  ...over,
});
const body = (workers = [worker()]) => ({
  source: 'LIVE',
  generatedAt: '2026-10-13T11:21:00.000Z',
  workers,
  queues: [
    { stream: 'jobs:normal', waiting: 4, inFlight: 1, capped: false },
    { stream: 'jobs:video', waiting: null, inFlight: null, capped: false },
  ],
});
const respond = (status: number, json?: unknown) =>
  (async () =>
    new Response(json === undefined ? null : JSON.stringify(json), { status })) as typeof fetch;

describe('parseLiveFleet', () => {
  it('accepts the API response', () => {
    expect(parseLiveFleet(body()).workers).toHaveLength(1);
  });

  it('rejects a payload that is not a LIVE fleet snapshot', () => {
    expect(() => parseLiveFleet(null)).toThrow(FleetLoadError);
    expect(() => parseLiveFleet({ ...body(), source: 'FIXTURE' })).toThrow(FleetLoadError);
    expect(() => parseLiveFleet({ ...body(), generatedAt: 'yesterday-ish' })).toThrow(
      FleetLoadError,
    );
    expect(() => parseLiveFleet({ ...body(), workers: {} })).toThrow(FleetLoadError);
  });

  it('rejects a worker with an unknown state instead of rendering it as healthy', () => {
    expect(() => parseLiveFleet(body([worker({ health: 'DEGRADEDISH' })]))).toThrow(FleetLoadError);
    expect(() => parseLiveFleet(body([worker({ comfy: null })]))).toThrow(FleetLoadError);
  });

  it('drops fields the UI contract does not name', () => {
    const parsed = parseLiveFleet(body([worker({ url: 'https://leak.invalid', apiKey: 'k' })]));
    expect(JSON.stringify(parsed)).not.toContain('leak.invalid');
  });
});

describe('toSnapshot', () => {
  it('keeps the server time as asOf so freshness is not measured against the browser clock', () => {
    const snap = toSnapshot(parseLiveFleet(body()));
    expect(snap.source).toBe('LIVE');
    expect(snap.asOf).toBe('2026-10-13T11:21:00.000Z');
    expect(freshness('2026-10-13T11:20:50.000Z', snap.asOf)).toBe('FRESH');
  });

  it('maps observed VRAM and host RAM, and nothing the API did not observe', () => {
    const snap = toSnapshot(parseLiveFleet(body()));
    const [w] = snap.workers;
    expect(w?.ownership).toBe('PRODUCTION');
    expect(w?.prompt).toEqual({
      id: 'prompt-1',
      owner: 'PRODUCTION',
      observedAt: '2026-10-13T11:20:50.000Z',
      jobId: 'job-1',
    });
    expect(w?.gpu).toEqual({
      utilizationPct: null,
      vramUsedMb: 40960,
      vramTotalMb: 98304,
      temperatureC: null,
    });
    // Exporters are not measured; the timestamp is the /system_stats sample's.
    expect(w?.monitoring).toEqual({
      gpuExporterUp: null,
      nodeExporterUp: null,
      lastSeenAt: '2026-10-13T11:20:50.000Z',
    });
    const host = snap.hosts[0];
    expect(host).toMatchObject({ inventoryVerified: false, provider: null, rented: null });
    expect(host?.memory).toMatchObject({ totalGb: 82.5, availableGb: 58.7, swapTotalGb: null });
    expect(host?.storage).toEqual({
      usedGb: null,
      totalGb: null,
      observedAt: null,
      inodesUsedPct: null,
    });
    expect(snap.gpus[0]).toMatchObject({ model: 'Example GPU', vramTotalMb: 98304 });
    expect([snap.incidents, snap.jobs]).toEqual([[], []]);
  });

  it('marks a running prompt with no matching job as unattributed, not production', () => {
    const w = worker({
      ownership: 'UNATTRIBUTED',
      prompt: { id: 'p', jobId: null, observedAt: '2026-10-13T11:20:50.000Z' },
    });
    const [mapped] = toSnapshot(parseLiveFleet(body([w]))).workers;
    expect(mapped?.ownership).toBe('UNATTRIBUTED');
    expect(mapped?.prompt?.owner).toBe('UNATTRIBUTED');
  });

  it('carries the dispatch backlog through, keeping unobserved streams null', () => {
    const snap = toSnapshot(parseLiveFleet(body()));
    expect(snap.queues).toEqual([
      { stream: 'jobs:normal', waiting: 4, inFlight: 1, capped: false },
      { stream: 'jobs:video', waiting: null, inFlight: null, capped: false },
    ]);
  });

  it('rejects an unknown ownership value and a missing queues list', () => {
    expect(() => parseLiveFleet(body([worker({ ownership: 'FOREIGN' })]))).toThrow(FleetLoadError);
    expect(() => parseLiveFleet({ ...body(), queues: undefined })).toThrow(FleetLoadError);
  });

  it('leaves telemetry unknown for a worker with no system sample', () => {
    const none = worker({
      gpu: { name: null, vramUsedMb: null, vramTotalMb: null, observedAt: null, stale: true },
      hostMemory: { totalGb: null, availableGb: null, observedAt: null, stale: true },
    });
    const [w] = toSnapshot(parseLiveFleet(body([none]))).workers;
    expect(w?.gpu.vramUsedMb).toBeNull();
    expect(w?.monitoring.lastSeenAt).toBeNull();
  });

  it('rejects a worker missing the gpu or hostMemory block', () => {
    expect(() => parseLiveFleet(body([worker({ gpu: undefined })]))).toThrow(FleetLoadError);
    expect(() => parseLiveFleet(body([worker({ hostMemory: null })]))).toThrow(FleetLoadError);
  });

  it('shows a stale queue sample as unknown, not as the last value', () => {
    const stale = worker({
      comfy: {
        reachable: true,
        running: 3,
        pending: 9,
        observedAt: '2026-10-13T10:00:00.000Z',
        stale: true,
      },
    });
    const [w] = toSnapshot(parseLiveFleet(body([stale]))).workers;
    expect(w?.comfy).toEqual({ reachable: null, running: null, pending: null });
  });

  it('gives each worker its own unmapped GPU so none are reported as sharing one', () => {
    const snap = toSnapshot(
      parseLiveFleet(body([worker(), worker({ workerId: 'worker-4', label: 'w4' })])),
    );
    const ids = snap.workers.map((w) => w.gpuId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('createLiveRepository', () => {
  const repo = (f: typeof fetch, token: string | null = 't') =>
    createLiveRepository('http://api.invalid/', () => token, f);

  it('sends the bearer token to /admin/fleet and maps the result', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      seen = {
        url,
        auth: new Headers(init?.headers).get('authorization'),
      };
      return new Response(JSON.stringify(body()), { status: 200 });
    }) as unknown as typeof fetch;
    const snap = await repo(f).load();
    expect(seen).toEqual({ url: 'http://api.invalid/admin/fleet', auth: 'Bearer t' });
    expect(snap.workers[0]?.workerId).toBe('worker-3');
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [500, 'UNAVAILABLE'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    await expect(repo(respond(status)).load()).rejects.toMatchObject({ kind });
  });

  it('maps a network failure to UNAVAILABLE and a bad body to INVALID', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(repo(down).load()).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    await expect(repo(respond(200, { nope: true })).load()).rejects.toMatchObject({
      kind: 'INVALID',
    });
  });

  it('refuses to call the API without a token', async () => {
    await expect(repo(respond(200, body()), null).load()).rejects.toMatchObject({
      kind: 'UNAUTHORIZED',
    });
  });
});
