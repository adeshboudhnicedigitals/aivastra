import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyWatermark, initWatermarkTile, tileOffsetForJob } from './watermark.js';

async function makeTestImage(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('WatermarkService', () => {
  beforeAll(async () => {
    await initWatermarkTile();
  });

  it('applies a composite without throwing, output is a valid, larger-than-trivial PNG', async () => {
    const image = await makeTestImage(800, 1200);
    const result = await applyWatermark({ image, jobId: 'job-a' });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(1200);
    expect(meta.format).toBe('png');
  });

  it('is deterministic for the same jobId', async () => {
    const image = await makeTestImage(600, 600);
    const a = await applyWatermark({ image, jobId: 'same-job' });
    const b = await applyWatermark({ image, jobId: 'same-job' });
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('produces a different composite for different jobIds (jobId-seeded offset)', async () => {
    const image = await makeTestImage(600, 600);
    const a = await applyWatermark({ image, jobId: 'job-one' });
    const b = await applyWatermark({ image, jobId: 'job-two' });
    // Not a byte-for-byte guarantee for every possible pair, but job-one/job-two
    // hash to different offsets — this pins the regression the spec calls out
    // (every image getting the identical watermark placement).
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('tileOffsetForJob returns a stable offset within tile bounds for a given jobId', () => {
    const offset1 = tileOffsetForJob('deterministic-job');
    const offset2 = tileOffsetForJob('deterministic-job');
    expect(offset1).toEqual(offset2);
    expect(offset1.x).toBeGreaterThanOrEqual(0);
    expect(offset1.y).toBeGreaterThanOrEqual(0);
  });

  it('rejects with a clear error if applyWatermark is called before initWatermarkTile', async () => {
    // The module-level tile cache is a singleton, so exercise the uninitialized
    // state via a fresh module instance rather than the shared import above.
    // finalize.ts's fail-closed guarantee depends on apply() throwing here,
    // not silently returning the un-watermarked buffer.
    vi.resetModules();
    const fresh = await import('./watermark.js');
    const image = await makeTestImage(400, 400);
    await expect(fresh.applyWatermark({ image, jobId: 'job-init-check' })).rejects.toThrow(
      'WatermarkService not initialized',
    );
  });
});
