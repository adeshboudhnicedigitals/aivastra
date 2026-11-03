import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { overlayMerchantLogo } from './logo-overlay.js';

const solid = (w: number, h: number, c: { r: number; g: number; b: number }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } })
    .png()
    .toBuffer();

describe('overlayMerchantLogo', () => {
  it('paints the logo in the top-right corner and leaves the rest alone', async () => {
    const image = await solid(1000, 1500, { r: 255, g: 255, b: 255 });
    const logo = await solid(100, 100, { r: 255, g: 0, b: 0 });
    const out = await overlayMerchantLogo({ image, logo });

    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 1500]);

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(px(900, 80)).toEqual([255, 0, 0]); // inside top-right logo box
    expect(px(50, 50)).toEqual([255, 255, 255]); // top-left untouched
    expect(px(900, 1400)).toEqual([255, 255, 255]); // bottom-right untouched
  });

  it('keeps a wide logo inside the image', async () => {
    const image = await solid(400, 400, { r: 255, g: 255, b: 255 });
    const logo = await solid(600, 100, { r: 0, g: 0, b: 255 });
    const out = await overlayMerchantLogo({ image, logo });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([400, 400]);
  });
});
