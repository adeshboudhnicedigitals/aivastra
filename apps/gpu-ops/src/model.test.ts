import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureSnapshot } from './fixtures';
import { display, fleetCounts, freshness, grafanaLink, reconciliation, signals } from './model';

const snapshot = () => structuredClone(fixtureSnapshot);
afterEach(() => vi.unstubAllEnvs());
describe('unknown and stale observations', () => {
  it('preserves no data separately from real zero and flags stale or invalid timestamps', () => {
    expect(display(null, '%')).toBe('No data');
    expect(display(0, '%')).toBe('0%');
    expect(freshness(null, fixtureSnapshot.asOf)).toBe('NO DATA');
    expect(freshness('invalid', fixtureSnapshot.asOf)).toBe('NO DATA');
    expect(freshness('2026-10-12T09:01:00Z', fixtureSnapshot.asOf)).toBe('NO DATA');
    expect(freshness('2026-10-12T08:59:40Z', fixtureSnapshot.asOf)).toBe('FRESH');
    expect(freshness('2026-10-12T08:35:00Z', fixtureSnapshot.asOf)).toBe('STALE');
  });
  it('does not infer an empty queue from unavailable observations', () => {
    const worker = snapshot().workers[1];
    worker.comfy = { reachable: null, running: null, pending: null };
    expect(signals(worker)).not.toContain('Busy + empty queue');
    worker.comfy = { reachable: true, running: 0, pending: 0 };
    expect(signals(worker)).toContain('Busy + empty queue');
  });
});
describe('identity and reconciliation', () => {
  it('counts shared physical resources once', () => {
    expect(fleetCounts(snapshot())).toEqual({
      hosts: 8,
      gpus: 8,
      workers: 9,
      monitoredHosts: 3,
      incidents: 3,
    });
    // The monitored-only host is still an observed host; registry membership is separate.
    const data = snapshot();
    data.workers.push({ ...data.workers[1], workerId: 'another-logical-worker' });
    expect(fleetCounts(data).gpus).toBe(8);
    expect(fleetCounts(data).monitoredHosts).toBe(3);
  });
  it('exposes each reconciliation gap without interpreting unknown rental as billed', () => {
    const data = snapshot();
    expect(reconciliation(data.hosts[2], data)).toContain('Registry-only');
    expect(reconciliation(data.hosts[7], data)).toContain('Monitored-only');
    expect(reconciliation(data.hosts[6], data)).toEqual(
      expect.arrayContaining([
        'Rented-only',
        'Inactive-but-billed',
        'Exporter missing / unverified',
        'Inventory mismatch',
      ]),
    );
    data.hosts[6].rented = null;
    expect(reconciliation(data.hosts[6], data)).not.toContain('Inactive-but-billed');
  });
  it('flags broken worker to GPU mappings', () => {
    const data = snapshot();
    data.workers[0].gpuId = 'missing';
    expect(reconciliation(data.hosts[0], data)).toContain('Inventory mismatch');
  });
});
describe('Grafana integration', () => {
  it('keeps unconfigured or unsafe dashboards non-clickable', () => {
    vi.stubEnv('VITE_GRAFANA_GPU_URL', '');
    expect(grafanaLink('gpu', snapshot().workers[0])).toBeNull();
    vi.stubEnv('VITE_GRAFANA_GPU_URL', 'javascript:alert(1)');
    expect(grafanaLink('gpu', snapshot().workers[0])).toBeNull();
  });
  it('adds normalized identity while preserving dashboard parameters', () => {
    vi.stubEnv('VITE_GRAFANA_GPU_URL', 'https://grafana.example.test/d/gpu?orgId=1');
    const url = new URL(grafanaLink('gpu', snapshot().workers[0]) ?? '');
    expect(url.searchParams.get('var-worker')).toBe('worker-1');
    expect(url.searchParams.get('var-host')).toBe('host-1');
    expect(url.searchParams.get('var-gpu')).toBe('gpu-1');
    expect(url.searchParams.get('orgId')).toBe('1');
  });
});
