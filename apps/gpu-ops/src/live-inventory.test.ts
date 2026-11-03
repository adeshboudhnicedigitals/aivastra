import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from './fixtures';
import {
  applyInventory,
  FleetInventoryApiError,
  type Inventory,
  inventoryErrorMessage,
  loadInventory,
  mapWorker,
  parseInventory,
  saveHost,
} from './live-inventory';

const host = {
  id: 'box-7',
  label: 'Box 7',
  provider: 'Provider A',
  rented: true,
  monthlyCostUsd: 450.5,
  inventoryVerified: true,
  updatedAt: '2026-11-03T10:00:00.000Z',
  latestReview: {
    note: 'matches invoice',
    reviewedBy: 'ops@example.com',
    reviewedAt: '2026-11-03T10:05:00.000Z',
  },
};
const gpu = {
  id: 'gpu-a',
  hostId: 'box-7',
  model: 'RTX 4090',
  vramTotalMb: 24576,
  updatedAt: '2026-11-03T10:00:00.000Z',
};
const api = {
  generatedAt: '2026-11-03T10:10:00.000Z',
  hosts: [host],
  gpus: [gpu],
  workers: [
    { workerId: 'worker-1', label: 'one', hostId: 'box-7', gpuId: 'gpu-a' },
    { workerId: 'worker-2', label: 'two', hostId: null, gpuId: null },
  ],
};

describe('parseInventory', () => {
  it('accepts the API shape', () => {
    const inv = parseInventory(api);
    expect(inv.hosts[0]?.latestReview?.reviewedBy).toBe('ops@example.com');
    expect(inv.workers[1]).toMatchObject({ hostId: null, gpuId: null });
  });
  it.each([
    ['not an object', 'x'],
    ['bad date', { ...api, generatedAt: 'later' }],
    ['host without verified flag', { ...api, hosts: [{ ...host, inventoryVerified: 'yes' }] }],
    ['cost as string', { ...api, hosts: [{ ...host, monthlyCostUsd: '450' }] }],
    [
      'half a worker mapping',
      { ...api, workers: [{ workerId: 'w', label: 'w', hostId: 'box-7', gpuId: null }] },
    ],
    ['hosts not a list', { ...api, hosts: {} }],
    ['broken review', { ...api, hosts: [{ ...host, latestReview: { note: 5 } }] }],
  ])('rejects %s', (_n, v) => {
    expect(() => parseInventory(v)).toThrow(FleetInventoryApiError);
  });
});

describe('applyInventory', () => {
  const live = { ...fixtureSnapshot, source: 'LIVE' as const };
  const first = live.workers[0]!;
  const second = live.workers[1]!;
  const inv: Inventory = {
    ...parseInventory(api),
    workers: [
      { workerId: first.workerId, label: 'one', hostId: 'box-7', gpuId: 'gpu-a' },
      { workerId: second.workerId, label: 'two', hostId: null, gpuId: null },
    ],
  };

  it('is a no-op without inventory', () => {
    expect(applyInventory(live, null)).toBe(live);
    expect(applyInventory(live, { ...inv, hosts: [] })).toBe(live);
  });
  it('maps the worker and keeps unmapped workers on their original host', () => {
    const out = applyInventory(live, inv);
    expect(out.workers.find((w) => w.workerId === first.workerId)).toMatchObject({
      hostId: 'box-7',
      gpuId: 'gpu-a',
    });
    expect(out.workers.find((w) => w.workerId === second.workerId)).toMatchObject({
      hostId: second.hostId,
      gpuId: second.gpuId,
    });
  });
  it('shows the operator facts and drops only the replaced placeholders', () => {
    const out = applyInventory(live, inv);
    expect(out.hosts.find((h) => h.id === 'box-7')).toMatchObject({
      label: 'Box 7',
      provider: 'Provider A',
      monthlyCostUsd: 450.5,
      inventoryVerified: true,
    });
    expect(out.hosts.some((h) => h.id === first.hostId)).toBe(false);
    expect(out.hosts.some((h) => h.id === second.hostId)).toBe(true);
    expect(out.gpus.find((g) => g.id === 'gpu-a')).toMatchObject({
      model: 'RTX 4090',
      vramTotalMb: 24576,
      hostId: 'box-7',
    });
  });
  it('keeps the observed memory and falls back to observed GPU facts when none were recorded', () => {
    const observed = live.hosts.find((h) => h.id === first.hostId)!;
    const noGpuFacts: Inventory = { ...inv, gpus: [{ ...gpu, model: null, vramTotalMb: null }] };
    const out = applyInventory(live, noGpuFacts);
    expect(out.hosts.find((h) => h.id === 'box-7')?.memory).toEqual(observed.memory);
    const observedGpu = live.gpus.find((g) => g.id === first.gpuId)!;
    expect(out.gpus.find((g) => g.id === 'gpu-a')).toMatchObject({
      model: observedGpu.model,
      vramTotalMb: observedGpu.vramTotalMb,
    });
  });
  it('does not mutate its input', () => {
    const before = JSON.stringify(live);
    applyInventory(live, inv);
    expect(JSON.stringify(live)).toBe(before);
  });
});

describe('requests', () => {
  const ok = (body: unknown, capture?: (u: string, i: RequestInit) => void) =>
    (async (u: string, i: RequestInit) => (
      capture?.(u, i), new Response(JSON.stringify(body), { status: 200 })
    )) as unknown as typeof fetch;

  it('saveHost PUTs the input with the reason and a bearer token', async () => {
    let url = '';
    let init: RequestInit = {};
    await saveHost(
      'http://api/',
      'tok',
      'box-7',
      {
        label: 'Box 7',
        provider: null,
        rented: null,
        monthlyCostUsd: null,
        inventoryVerified: false,
        reason: 'because',
      },
      {
        fetchImpl: ok(api, (u, i) => ((url = u), (init = i))),
      },
    );
    expect(url).toBe('http://api/admin/fleet/inventory/hosts/box-7');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ reason: 'because' });
  });
  it('escapes ids in the path', async () => {
    let url = '';
    await mapWorker('http://api', 't', 'w/../x', { hostId: null, gpuId: null }, 'unmap it', {
      fetchImpl: ok(api, (u) => (url = u)),
    });
    expect(url).toBe('http://api/admin/fleet/inventory/workers/w%2F..%2Fx');
  });
  it('reads the API error envelope so the reason is visible', async () => {
    const f409 = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'HOST_IN_USE',
            message: 'Host still has 2 mapped workers; unmap them first.',
          },
        }),
        { status: 409 },
      )) as unknown as typeof fetch;
    const err = await loadInventory('http://api', 't', { fetchImpl: f409 }).catch((e) => e);
    expect(err).toBeInstanceOf(FleetInventoryApiError);
    expect(inventoryErrorMessage(err, 'edit')).toBe(
      'Host still has 2 mapped workers; unmap them first.',
    );
  });
  it('maps 401, 403 and an unreachable API to readable messages', async () => {
    const status = (code: number) =>
      (async () => new Response('{}', { status: code })) as unknown as typeof fetch;
    expect(
      inventoryErrorMessage(
        await loadInventory('http://api', 't', { fetchImpl: status(401) }).catch((e) => e),
      ),
    ).toBe('Session expired, sign in again.');
    expect(
      inventoryErrorMessage(
        await loadInventory('http://api', 't', { fetchImpl: status(403) }).catch((e) => e),
        'edit',
      ),
    ).toMatch(/fleet.operate/);
    expect(
      inventoryErrorMessage(
        await loadInventory('http://api', 't', { fetchImpl: status(403) }).catch((e) => e),
      ),
    ).toMatch(/fleet.view/);
    const down = (async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect(
      inventoryErrorMessage(
        await loadInventory('http://api', 't', { fetchImpl: down }).catch((e) => e),
      ),
    ).toBe('Fleet API unavailable.');
  });
});
