import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { stackAccessoryImages } from './accessory-stack.js';

async function makeColorImage(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe('stackAccessoryImages', () => {
  it('throws when given an empty array', async () => {
    await expect(stackAccessoryImages([])).rejects.toThrow(
      'stackAccessoryImages requires at least one image',
    );
  });

  it('returns the image unchanged in shape for a single input', async () => {
    const img = await makeColorImage(100, 60, { r: 255, g: 0, b: 0 });
    const result = await stackAccessoryImages([img]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(60);
    expect(meta.format).toBe('png');
  });

  it('stacks two same-width images vertically, summing heights', async () => {
    const top = await makeColorImage(100, 40, { r: 255, g: 0, b: 0 });
    const bottom = await makeColorImage(100, 60, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([top, bottom]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it('places images in input order, top to bottom', async () => {
    const top = await makeColorImage(40, 20, { r: 255, g: 0, b: 0 });
    const bottom = await makeColorImage(40, 20, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([top, bottom]);

    const topPixel = await sharp(result)
      .extract({ left: 5, top: 5, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const bottomPixel = await sharp(result)
      .extract({ left: 5, top: 25, width: 1, height: 1 })
      .raw()
      .toBuffer();

    expect(topPixel[0]).toBeGreaterThan(200); // red channel high → red image
    expect(bottomPixel[2]).toBeGreaterThan(200); // blue channel high → blue image
  });

  it('resizes a narrower image up to the widest selected image before stacking', async () => {
    const wide = await makeColorImage(200, 50, { r: 255, g: 0, b: 0 });
    const narrow = await makeColorImage(100, 50, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([wide, narrow]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
  });

  it('clamps the composite width to 2048, downscaling wider inputs', async () => {
    const huge = await makeColorImage(3000, 100, { r: 255, g: 0, b: 0 });
    const result = await stackAccessoryImages([huge]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(Math.round((100 * 2048) / 3000));
  });

  it('stacks three images in order, summing heights', async () => {
    const a = await makeColorImage(80, 10, { r: 255, g: 0, b: 0 });
    const b = await makeColorImage(80, 20, { r: 0, g: 255, b: 0 });
    const c = await makeColorImage(80, 30, { r: 0, g: 0, b: 255 });
    const result = await stackAccessoryImages([a, b, c]);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(60);
    const bottom = await sharp(result)
      .extract({ left: 5, top: 50, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(bottom[2]).toBeGreaterThan(200);
  });
});
