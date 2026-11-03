import type { WorkerSystemSample } from '@aivastra/types';

const bytes = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

// Device names are display text, not identifiers: drop control characters and cap the length.
const name = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const printable = [...v].filter((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f;
  });
  const cleaned = printable.join('').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
};

/**
 * Pulls the display-safe numbers out of a ComfyUI /system_stats body. Reads named fields only —
 * the body also carries launch arguments and file paths, so it is never stored or passed on
 * whole. Returns null when nothing usable is present, so a bad body leaves the previous sample
 * to expire rather than overwriting it with zeros.
 */
export function extractSystemSample(body: unknown, now: number): WorkerSystemSample | null {
  if (typeof body !== 'object' || body === null) return null;
  const { system, devices } = body as { system?: unknown; devices?: unknown };
  const sys =
    typeof system === 'object' && system !== null ? (system as Record<string, unknown>) : {};
  const device =
    Array.isArray(devices) && typeof devices[0] === 'object' && devices[0] !== null
      ? (devices[0] as Record<string, unknown>)
      : {};
  const sample: WorkerSystemSample = {
    observedAt: now,
    gpuName: name(device.name),
    vramTotalBytes: bytes(device.vram_total),
    vramFreeBytes: bytes(device.vram_free),
    ramTotalBytes: bytes(sys.ram_total),
    ramFreeBytes: bytes(sys.ram_free),
  };
  const anyValue =
    sample.vramTotalBytes !== null ||
    sample.vramFreeBytes !== null ||
    sample.ramTotalBytes !== null ||
    sample.ramFreeBytes !== null;
  return anyValue ? sample : null;
}
