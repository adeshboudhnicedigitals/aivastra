import { describe, expect, it } from 'vitest';
import { extractSystemSample } from './system-sample.js';

// Shape captured from a real worker's /system_stats on 2026-10-13 (values rounded, strings
// replaced). Includes `argv`, which must never reach the sample.
const real = {
  system: {
    os: 'posix',
    ram_total: 88558022656,
    ram_free: 63078637568,
    comfyui_version: '0.0.0',
    argv: ['main.py', '--listen', '--secret-flag', 'value'],
  },
  devices: [
    {
      name: 'cuda:0 Example GPU : cudaMallocAsync',
      type: 'cuda',
      index: 0,
      vram_total: 101975851008,
      vram_free: 58937942470,
      torch_vram_total: 26440892416,
      torch_vram_free: 41984454,
    },
  ],
};

describe('extractSystemSample', () => {
  it('keeps the whitelisted numbers and the device name', () => {
    expect(extractSystemSample(real, 1000)).toEqual({
      observedAt: 1000,
      gpuName: 'cuda:0 Example GPU : cudaMallocAsync',
      vramTotalBytes: 101975851008,
      vramFreeBytes: 58937942470,
      ramTotalBytes: 88558022656,
      ramFreeBytes: 63078637568,
    });
  });

  it('never carries launch arguments or other fields through', () => {
    const json = JSON.stringify(extractSystemSample(real, 1));
    expect(json).not.toContain('argv');
    expect(json).not.toContain('secret-flag');
    expect(json).not.toContain('torch_vram');
  });

  it('does not mix PyTorch cache figures into VRAM used', () => {
    const s = extractSystemSample(real, 1);
    expect(s?.vramFreeBytes).toBe(58937942470);
  });

  it('returns null rather than zeros when the body has nothing usable', () => {
    expect(extractSystemSample(null, 1)).toBeNull();
    expect(extractSystemSample('nope', 1)).toBeNull();
    expect(extractSystemSample({}, 1)).toBeNull();
    expect(extractSystemSample({ devices: [], system: {} }, 1)).toBeNull();
  });

  it('nulls individual fields that are the wrong type or negative', () => {
    const s = extractSystemSample(
      { system: { ram_total: '88', ram_free: -1 }, devices: [{ vram_total: 10, vram_free: NaN }] },
      1,
    );
    expect(s).toMatchObject({
      vramTotalBytes: 10,
      vramFreeBytes: null,
      ramTotalBytes: null,
      ramFreeBytes: null,
    });
  });

  it('strips control characters from the device name and caps its length', () => {
    const s = extractSystemSample(
      { devices: [{ name: `GPU\u0000\u001b[31m${'x'.repeat(300)}`, vram_total: 1 }] },
      1,
    );
    expect(s?.gpuName).not.toMatch(/[\u0000-\u001f]/);
    expect(s?.gpuName?.length).toBeLessThanOrEqual(120);
  });
});
