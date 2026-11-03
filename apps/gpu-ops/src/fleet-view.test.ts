import { describe, expect, it } from 'vitest';
import type { FleetWorkerView } from './contracts';
import {
  agentHasFreshTelemetry,
  agentHostFacts,
  comfyView,
  dispatcherLabel,
  fleetTiles,
  withAgentGpu,
} from './fleet-view';
import type { FleetAgentSummary } from './live-agent';

const summary = (
  over: Partial<NonNullable<FleetAgentSummary['telemetry']>> | null,
  workerId = 'w',
): FleetAgentSummary => ({
  workerId,
  heartbeatAt: null,
  incidents: { critical: 0, warning: 0, info: 0 },
  telemetry:
    over === null
      ? null
      : {
          observedAt: '2026-11-02T12:00:00.000Z',
          stale: false,
          gpuCount: 1,
          tempMaxC: 50,
          clockRatioMin: 1,
          utilGpuPctMax: 0,
          powerWTotal: 90,
          vramUsedMib: 1000,
          vramTotalMib: 2000,
          ramAvailMib: 1,
          ramTotalMib: 2,
          swapUsedMib: 0,
          diskUsedPctMax: 50,
          comfy: { reachable: true, running: 1, pending: 0 },
          ...over,
        },
});
const dispatchWorker = (reachable: boolean | null, running: number | null = 0) => ({
  jobTypes: ['tryon'],
  comfy: { reachable, running, pending: 0 },
});
const telemetryOnly = () => ({
  jobTypes: [] as string[],
  comfy: { reachable: false, running: null, pending: null },
});

describe('comfyView', () => {
  it('uses the agent when the dispatcher has no observation, and says so', () => {
    const v = comfyView(dispatchWorker(null), summary({}));
    expect(v).toMatchObject({ source: 'agent', conflict: false });
    expect(v.headline).toBe('Reachable · 1 running · 0 pending');
    expect(v.detail).toMatch(/agent/i);
  });

  it('ignores the dispatcher entirely for a worker that takes no jobs', () => {
    expect(comfyView(telemetryOnly(), summary({})).source).toBe('agent');
    expect(comfyView(telemetryOnly(), undefined).headline).toBe('Reachability unknown');
  });

  it('shows BOTH when the box is up and the dispatcher cannot reach ComfyUI', () => {
    const v = comfyView(dispatchWorker(false), summary({}));
    expect(v.conflict).toBe(true);
    expect(v.source).toBe('both');
    expect(v.headline).toMatch(/Agent: reachable on the box/);
    expect(v.headline).toMatch(/Dispatcher: cannot reach it/);
  });

  it('reports a box where ComfyUI is down even if the dispatcher still says up', () => {
    const v = comfyView(
      dispatchWorker(true),
      summary({ comfy: { reachable: false, running: null, pending: null } }),
    );
    expect(v.conflict).toBe(true);
    expect(v.headline).toMatch(/not answering on the box/);
  });

  it('keeps the dispatcher line when both agree', () => {
    const v = comfyView(dispatchWorker(true, 2), summary({}));
    expect(v).toMatchObject({ conflict: false, source: 'both' });
    expect(v.headline).toBe('2 running · 0 pending');
  });

  it('does not trust a stale agent sample', () => {
    expect(comfyView(telemetryOnly(), summary({ stale: true })).headline).toBe(
      'Reachability unknown',
    );
  });

  it('stays unknown when nothing observes it, and never invents counts', () => {
    expect(comfyView(dispatchWorker(null), undefined).headline).toBe('Reachability unknown');
    expect(comfyView(dispatchWorker(null), summary(null)).headline).toBe('Reachability unknown');
    const v = comfyView(
      telemetryOnly(),
      summary({ comfy: { reachable: true, running: null, pending: null } }),
    );
    expect(v.headline).toBe('Reachable · unknown running · unknown pending');
  });
});

describe('dispatcherLabel', () => {
  it('distinguishes telemetry-only rows and rows the dispatcher has not registered', () => {
    expect(dispatcherLabel({ jobTypes: [], inRegistry: true })).toMatch(/Not part of dispatch/);
    expect(dispatcherLabel({ jobTypes: ['tryon'], inRegistry: false })).toBe(
      'Not seen by the dispatcher',
    );
    expect(dispatcherLabel({ jobTypes: ['tryon'], inRegistry: true })).toBeNull();
  });
});

describe('fleetTiles', () => {
  const rows = [
    {
      workerId: 'real',
      jobTypes: ['tryon'],
      health: 'HEALTHY' as const,
      dispatcherTelemetryFresh: true,
    },
    {
      workerId: 'down',
      jobTypes: ['tryon'],
      health: 'UNREACHABLE' as const,
      dispatcherTelemetryFresh: false,
    },
    {
      workerId: 'tele',
      jobTypes: [],
      health: 'UNREACHABLE' as const,
      dispatcherTelemetryFresh: false,
    },
    { workerId: 'none', jobTypes: [], health: 'UNKNOWN' as const, dispatcherTelemetryFresh: false },
  ];

  it('does not count telemetry-only rows as unreachable or healthy', () => {
    const t = fleetTiles(rows, [summary({}, 'tele')]);
    expect(t.unreachable).toBe(1);
    expect(t.healthy).toBe(1);
    expect(t.dispatchWorkers).toBe(2);
  });

  it('counts a worker as having telemetry if EITHER source is fresh', () => {
    const t = fleetTiles(rows, [summary({}, 'tele'), summary({ stale: true }, 'down')]);
    expect(t.withFreshTelemetry).toBe(2); // real (dispatcher) + tele (agent)
    expect(t.withoutTelemetry).toBe(2);
    expect(agentHasFreshTelemetry(summary({ stale: true }))).toBe(false);
  });

  it('reports agent coverage as reporting of monitored', () => {
    const t = fleetTiles(rows, [summary({}, 'tele'), summary(null, 'none')]);
    expect(t).toMatchObject({ agentMonitored: 2, agentReporting: 1 });
  });

  it('sums VRAM only over fresh, complete boxes and is null (no data) otherwise', () => {
    expect(fleetTiles(rows, null).vram).toBeNull();
    expect(fleetTiles(rows, [summary({ stale: true }, 'a')]).vram).toBeNull();
    expect(fleetTiles(rows, [summary({ vramUsedMib: null }, 'a')]).vram).toBeNull();
    expect(fleetTiles(rows, [summary({}, 'a'), summary({ vramUsedMib: 500 }, 'b')]).vram).toEqual({
      usedMib: 1500,
      totalMib: 4000,
      boxes: 2,
    });
  });
});

describe('withAgentGpu / agentHostFacts', () => {
  const worker = (gpu: Partial<FleetWorkerView['gpu']>) =>
    ({
      gpu: { utilizationPct: null, vramUsedMb: 5, vramTotalMb: 10, temperatureC: null, ...gpu },
    }) as FleetWorkerView;

  it('fills a missing temperature and utilisation from a fresh agent', () => {
    const w = withAgentGpu(worker({}), summary({ tempMaxC: 61, utilGpuPctMax: 7 }));
    expect(w.gpu.temperatureC).toBe(61);
    expect(w.gpu.utilizationPct).toBe(7);
  });

  it('never replaces a value the dispatcher reported', () => {
    const w = withAgentGpu(worker({ utilizationPct: 3 }), summary({ utilGpuPctMax: 90 }));
    expect(w.gpu.utilizationPct).toBe(3);
  });

  it('leaves the worker untouched for a stale or missing agent', () => {
    const base = worker({});
    expect(withAgentGpu(base, summary({ stale: true }))).toBe(base);
    expect(withAgentGpu(base, undefined)).toBe(base);
  });

  it('keeps an unknown agent reading as null, not zero', () => {
    const w = withAgentGpu(worker({}), summary({ tempMaxC: null }));
    expect(w.gpu.temperatureC).toBeNull();
  });

  it('converts agent host figures to GiB and returns null when stale', () => {
    const f = agentHostFacts(summary({ ramTotalMib: 2048, ramAvailMib: 1024, swapUsedMib: null }));
    expect(f).toMatchObject({ ramTotalGb: 2, ramAvailGb: 1, swapUsedGb: null, diskUsedPct: 50 });
    expect(agentHostFacts(summary({ stale: true }))).toBeNull();
  });
});
