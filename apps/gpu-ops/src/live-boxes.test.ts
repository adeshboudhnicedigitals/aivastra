import { describe, expect, it } from 'vitest';
import { boxHealth, type FleetBox, parseEnrollTokens, parseFleetBoxes } from './live-boxes';

const telemetry = {
  observedAt: '2026-11-03T10:00:00.000Z',
  stale: false,
  gpuCount: 1,
  tempMaxC: 60,
  clockRatioMin: 0.9,
  utilGpuPctMax: 50,
  powerWTotal: 200,
  vramUsedMib: 1000,
  vramTotalMib: 49140,
  ramAvailMib: 60000,
  ramTotalMib: 128000,
  swapUsedMib: 0,
  diskUsedPctMax: 70,
  comfy: { reachable: true, running: 1, pending: 0 },
};
const box = (over: Record<string, unknown> = {}) => ({
  id: 'w6',
  label: 'w6',
  workerId: 'tryon-worker-6',
  dispatcher: 'in_rotation',
  agentEnrolled: true,
  heartbeatAt: '2026-11-03T10:00:01.000Z',
  lastSeenAt: '2026-11-03T10:00:00.000Z',
  agentVersion: '0.2.0',
  hardware: {
    gpus: [{ index: 0, name: 'NVIDIA RTX A6000', vramTotalMib: 49140 }],
    driverVersion: '595.58.03',
    cpuCount: 16,
    ramTotalMib: 128000,
    diskTotalGb: 1000,
  },
  hardwareAt: '2026-11-03T09:00:00.000Z',
  telemetry,
  jobs24h: { completed: 10, failed: 1 },
  incidents: { critical: 0, warning: 0, info: 0 },
  ...over,
});
const parsed = (over: Record<string, unknown> = {}): FleetBox =>
  parseFleetBoxes({ generatedAt: '2026-11-03T10:00:02.000Z', boxes: [box(over)] })
    .boxes[0] as FleetBox;

describe('parseFleetBoxes', () => {
  it('reads a full box', () => {
    const b = parsed();
    expect(b.hardware?.driverVersion).toBe('595.58.03');
    expect(b.telemetry?.diskUsedPctMax).toBe(70);
    expect(b.dispatcher).toBe('in_rotation');
  });
  it('keeps unknowns as null, not zero', () => {
    const b = parsed({ hardware: null, telemetry: null, jobs24h: null, heartbeatAt: null });
    expect(b.hardware).toBeNull();
    expect(b.telemetry).toBeNull();
    expect(b.jobs24h).toBeNull();
  });
  it('rejects unknown fields, bad states and duplicate ids', () => {
    expect(() => parsed({ extra: 1 })).toThrow();
    expect(() => parsed({ dispatcher: 'busy' })).toThrow();
    expect(() => parsed({ jobs24h: { completed: -1, failed: 0 } })).toThrow();
    expect(() =>
      parseFleetBoxes({ generatedAt: '2026-11-03T10:00:02.000Z', boxes: [box(), box()] }),
    ).toThrow();
  });
});

describe('boxHealth comes from the box, never the dispatcher', () => {
  it('a disabled worker with a healthy box is OK', () => {
    expect(boxHealth(parsed({ dispatcher: 'disabled' }))).toBe('ok');
  });
  it('a box the dispatcher cannot reach but that reports fine is OK', () => {
    expect(boxHealth(parsed({ dispatcher: 'not_reachable' }))).toBe('ok');
  });
  it('flags disk, heat and open incidents as attention', () => {
    expect(boxHealth(parsed({ telemetry: { ...telemetry, diskUsedPctMax: 93 } }))).toBe('warn');
    expect(boxHealth(parsed({ telemetry: { ...telemetry, tempMaxC: 88 } }))).toBe('warn');
    expect(boxHealth(parsed({ incidents: { critical: 0, warning: 1, info: 0 } }))).toBe('warn');
  });
  it('ComfyUI down beats attention; silence beats both', () => {
    const down = {
      ...telemetry,
      diskUsedPctMax: 95,
      comfy: { reachable: false, running: null, pending: null },
    };
    expect(boxHealth(parsed({ telemetry: down }))).toBe('down');
    expect(boxHealth(parsed({ heartbeatAt: null }))).toBe('silent');
    expect(boxHealth(parsed({ telemetry: { ...telemetry, stale: true } }))).toBe('silent');
  });
  it('no working key is "no agent", whatever else', () => {
    expect(boxHealth(parsed({ agentEnrolled: false }))).toBe('not_enrolled');
  });
});

describe('parseEnrollTokens', () => {
  it('never accepts a listing that carries a secret', () => {
    const row = {
      id: 'a',
      label: 'vps-sync',
      tokenPrefix: 'fe_abcdefgh',
      createdAt: '2026-11-03T10:00:00.000Z',
      revokedAt: null,
      lastUsedAt: null,
    };
    expect(parseEnrollTokens({ tokens: [row] })).toHaveLength(1);
    expect(() => parseEnrollTokens({ tokens: [{ ...row, token: 'fe_x' }] })).toThrow();
  });
});
