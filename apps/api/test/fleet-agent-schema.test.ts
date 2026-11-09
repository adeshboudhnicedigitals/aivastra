import { type AgentTelemetry, agentTelemetrySchema } from '@aivastra/types';
import { describe, expect, it } from 'vitest';
import { deriveGpuSignals } from '../src/modules/fleet/signals.js';

const gpu = (over: Record<string, unknown> = {}) => ({
  index: 0,
  name: 'Example GPU',
  tempC: 70,
  memTempC: null,
  fanPct: null,
  pstate: 'P0',
  smClockMhz: 2400,
  smClockMaxMhz: 2430,
  memClockMhz: 14001,
  powerW: 300,
  powerLimitW: 600,
  utilGpuPct: 90,
  utilMemPct: 50,
  vramUsedMib: 48000,
  vramTotalMib: 97887,
  throttleReasons: null,
  eccUncorrected: null,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  v: 1,
  workerId: 'w1',
  agentVersion: '0.1.0',
  bootId: '3f1c2b4a-0000-4000-8000-000000000001',
  seq: 1,
  observedAt: 1_793_000_000_000,
  gpus: [gpu()],
  computeApps: [],
  host: {
    cpuCount: 16,
    load1: 1,
    load5: 1,
    load15: 1,
    ramTotalMib: 84480,
    ramAvailMib: 6000,
    swapTotalMib: 8192,
    swapUsedMib: 0,
    memPsiSome10: null,
    uptimeSec: 100,
    ntpSynced: true,
    disks: [{ mount: '/', totalGb: 960, usedGb: 700, inodeUsedPct: 10 }],
  },
  services: [{ name: 'comfyui', active: 'active', sub: 'running', restarts: 0 }],
  comfy: [{ instance: 'main', reachable: true, running: 0, pending: 0 }],
  ...over,
});

const parse = (p: unknown) => agentTelemetrySchema.safeParse(p);

describe('agentTelemetrySchema', () => {
  it('accepts a complete sample and keeps null as null', () => {
    const r = parse(payload());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.gpus[0]?.throttleReasons).toBeNull();
      expect(r.data.host.memPsiSome10).toBeNull();
    }
  });

  it('rejects any field this version does not know, at every level', () => {
    expect(parse(payload({ extra: 1 })).success).toBe(false);
    expect(parse(payload({ gpus: [gpu({ uuid: 'GPU-abc' })] })).success).toBe(false);
    const p = payload();
    (p.host as Record<string, unknown>).hostname = 'box';
    expect(parse(p).success).toBe(false);
  });

  it('rejects the wrong protocol version', () => {
    expect(parse(payload({ v: 2 })).success).toBe(false);
  });

  it.each([
    ['negative temperature beyond range', gpu({ tempC: 500 })],
    ['percent above 100', gpu({ utilGpuPct: 101 })],
    ['negative VRAM', gpu({ vramUsedMib: -1 })],
    ['NaN power', gpu({ powerW: Number.NaN })],
    ['non-integer clock', gpu({ smClockMhz: 100.5 })],
    ['bad pstate', gpu({ pstate: 'fast' })],
    ['throttle reasons that are not a hex bitmask', gpu({ throttleReasons: 'Active' })],
    ['control character in the device name', gpu({ name: 'GPU\u0000' })],
    ['name too long', gpu({ name: 'x'.repeat(121) })],
  ])('rejects %s', (_label, g) => {
    expect(parse(payload({ gpus: [g] })).success).toBe(false);
  });

  it('rejects duplicate GPU indexes and oversize lists', () => {
    expect(parse(payload({ gpus: [gpu(), gpu()] })).success).toBe(false);
    const many = Array.from({ length: 17 }, (_, i) => gpu({ index: i }));
    expect(parse(payload({ gpus: many })).success).toBe(false);
    const apps = Array.from({ length: 65 }, () => ({ gpuIndex: 0, name: 'python', vramMib: 1 }));
    expect(parse(payload({ computeApps: apps })).success).toBe(false);
  });

  it('only accepts logical service names, not unit names or paths', () => {
    const svc = (name: string) => ({ name, active: 'active', sub: null, restarts: 0 });
    expect(parse(payload({ services: [svc('comfyui')] })).success).toBe(true);
    expect(parse(payload({ services: [svc('../etc/passwd')] })).success).toBe(false);
    expect(parse(payload({ services: [svc('ComfyUI Main')] })).success).toBe(false);
  });

  it('requires a worker id, boot id and a positive observation time', () => {
    expect(parse(payload({ workerId: '' })).success).toBe(false);
    expect(parse(payload({ bootId: 'not a uuid!' })).success).toBe(false);
    expect(parse(payload({ observedAt: 0 })).success).toBe(false);
  });

  it('counts length in characters, so an emoji is one, as the agent counts it', () => {
    // GPU name is a text(120) field: 120 emoji are 240 UTF-16 units but 120 characters.
    expect(parse(payload({ gpus: [gpu({ name: '🔥'.repeat(120) })] })).success).toBe(true);
    expect(parse(payload({ gpus: [gpu({ name: '🔥'.repeat(121) })] })).success).toBe(false);
  });

  describe('log lines', () => {
    const logsOf = (lines: unknown[]) => {
      const r = parse(payload({ logs: [{ unit: 'comfyui', lines }] }));
      expect(r.success).toBe(true);
      return r.success ? r.data.logs?.[0]?.lines : undefined;
    };

    it('accepts the w1 line that was rejected: 300 characters with emoji (308 UTF-16 units)', () => {
      const line = `[ERROR] Value not in list: preset_prompt: '📝 Custom Prompt Only' not in ['🍿 Wan', '🎥 Wan', '🎬 Wan', ${'x'.repeat(300)}`;
      const cut = [...line].slice(0, 300).join('');
      expect(cut.length).toBeGreaterThan(300);
      expect(logsOf([cut])).toEqual([cut]);
    });

    it('cuts a too-long line instead of rejecting the sample', () => {
      const [line] = logsOf(['e'.repeat(1000)]) ?? [];
      expect(line).toBe('e'.repeat(300));
    });

    it('cuts by characters and never splits an emoji', () => {
      const [line] = logsOf(['📝'.repeat(400)]) ?? [];
      expect([...(line ?? '')]).toHaveLength(300);
      expect(line).toBe('📝'.repeat(300));
    });

    it('turns control characters into spaces and drops empty or non-string lines', () => {
      expect(logsOf(['a\tb\x1b[31mc', '', '   ', 42, null, 'ok'])).toEqual(['a b [31mc', 'ok']);
    });

    it('keeps only the newest 40 lines', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      expect(logsOf(lines)).toEqual(lines.slice(-40));
    });

    it('still rejects a bad unit name or a non-array lines field', () => {
      expect(parse(payload({ logs: [{ unit: '../etc', lines: ['x'] }] })).success).toBe(false);
      expect(parse(payload({ logs: [{ unit: 'comfyui', lines: 'x' }] })).success).toBe(false);
    });
  });
});

describe('deriveGpuSignals', () => {
  const sig = (over: Record<string, unknown>, apps: unknown[] = []) =>
    deriveGpuSignals(
      agentTelemetrySchema.parse(
        payload({ gpus: [gpu(over)], computeApps: apps }),
      ) as AgentTelemetry,
    )[0];

  it('flags thermal collapse from the clock ratio and temperature together', () => {
    // The measured case: ~2400 MHz fell to ~900 MHz at 85-88 C with no throttle reason reported.
    expect(sig({ tempC: 86, smClockMhz: 899, smClockMaxMhz: 2430 })).toMatchObject({
      thermalCollapseNow: true,
      clockRatio: 0.37,
    });
  });

  it('does not flag a low clock on a cool card, or a hot card at full clock', () => {
    expect(sig({ tempC: 50, smClockMhz: 300 })?.thermalCollapseNow).toBe(false);
    expect(sig({ tempC: 88, smClockMhz: 2400 })?.thermalCollapseNow).toBe(false);
  });

  it('is unknown, not false, when an input is unknown', () => {
    expect(sig({ tempC: null })?.thermalCollapseNow).toBeNull();
    expect(sig({ smClockMhz: null })).toMatchObject({ clockRatio: null, thermalCollapseNow: null });
    expect(sig({ smClockMaxMhz: 0 })?.clockRatio).toBeNull();
  });

  it('computes foreign VRAM only when processes are visible on that GPU', () => {
    const ours = [{ gpuIndex: 0, name: 'python', vramMib: 40000 }];
    expect(sig({ vramUsedMib: 48000 }, ours)?.foreignVramMib).toBe(8000);
    // No visible processes: a shared pod may hide them, so this is unknown rather than all-foreign.
    expect(sig({ vramUsedMib: 48000 }, [])?.foreignVramMib).toBeNull();
    // Processes only on another GPU say nothing about this one.
    expect(
      sig({ vramUsedMib: 48000 }, [{ gpuIndex: 1, name: 'python', vramMib: 1 }])?.foreignVramMib,
    ).toBeNull();
  });

  it('treats inconsistent or partial process data as unknown', () => {
    const over = [{ gpuIndex: 0, name: 'python', vramMib: 60000 }];
    expect(sig({ vramUsedMib: 48000 }, over)?.foreignVramMib).toBeNull();
    const partial = [{ gpuIndex: 0, name: 'python', vramMib: null }];
    expect(sig({ vramUsedMib: 48000 }, partial)?.foreignVramMib).toBeNull();
    expect(
      sig({ vramUsedMib: null }, [{ gpuIndex: 0, name: 'p', vramMib: 1 }])?.foreignVramMib,
    ).toBeNull();
  });
});
