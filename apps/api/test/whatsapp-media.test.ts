import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  fitForWhatsapp,
  WHATSAPP_IMAGE_MAX_BYTES,
} from '../src/modules/messaging/channels/whatsapp/media';

// Random pixels barely compress, so a modest size is enough to pass 5 MB as PNG.
async function noisePng(px: number): Promise<Buffer> {
  const raw = randomBytes(px * px * 3);
  return sharp(raw, { raw: { width: px, height: px, channels: 3 } })
    .png()
    .toBuffer();
}

describe('fitForWhatsapp', () => {
  it('passes an image under the limit through unchanged', async () => {
    const small = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#c33' },
    })
      .png()
      .toBuffer();
    const out = await fitForWhatsapp(small, 'image/png');
    expect(out.bytes).toBe(small);
    expect(out.mimeType).toBe('image/png');
  });

  it('re-encodes an over-limit result as a JPEG under the limit', async () => {
    // Meta rejects >5 MB uploads with (#100) "File too large" (seen 2026-10-14
    // on a 7.5 MB 4096px result), and the delivery loop would retry it forever.
    const big = await noisePng(1600);
    expect(big.length).toBeGreaterThan(WHATSAPP_IMAGE_MAX_BYTES);
    const out = await fitForWhatsapp(big, 'image/png');
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.bytes.length).toBeLessThanOrEqual(WHATSAPP_IMAGE_MAX_BYTES);
    expect((await sharp(out.bytes).metadata()).format).toBe('jpeg');
  });

  it('re-encodes webp (not a WhatsApp image type) even when small', async () => {
    const webp = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#3c3' },
    })
      .webp()
      .toBuffer();
    const out = await fitForWhatsapp(webp, 'image/webp');
    expect(out.mimeType).toBe('image/jpeg');
  });
});
