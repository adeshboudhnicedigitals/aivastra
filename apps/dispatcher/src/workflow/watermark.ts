import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export const WATERMARK_VERSION = 1;

let tileBuffer: Buffer | null = null;
let tileWidth = 0;
let tileHeight = 0;

/**
 * Initialize the watermark tile. Must be called at startup.
 * Throws if the logo is missing or Sharp fails to init, failing the dispatcher closed.
 */
export async function initWatermarkTile() {
  if (tileBuffer) return;

  const logoPath = join(process.cwd(), 'assets', 'watermark-logo.svg');
  const logoBytes = readFileSync(logoPath);

  // Pre-render the small repeating unit once: logo + wordmark, ~35° rotation, ~12% opacity.
  const logoImage = sharp(logoBytes)
    .resize({ width: 200 })
    .rotate(-35, { background: { r: 0, g: 0, b: 0, alpha: 0 } });

  const metadata = await logoImage.metadata();
  const width = metadata.width ?? 200;
  const height = metadata.height ?? 200;

  // Create a slightly larger tile to give spacing between repeated logos
  tileWidth = width + 100;
  tileHeight = height + 100;

  // Composite the logo onto the center of the tile, with opacity applied.
  // Instead of applying opacity to the base, we composite it such that
  // the resulting tile has the logo faintly visible.
  tileBuffer = await sharp({
    create: {
      width: tileWidth,
      height: tileHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await logoImage.toBuffer(),
        gravity: 'center',
        blend: 'over',
      },
    ])
    // Reduce overall opacity of the tile to ~12% by adjusting the alpha channel.
    .ensureAlpha(0.12)
    .png()
    .toBuffer();
}

/**
 * Applies the watermark tile across the target image canvas.
 */
export async function applyWatermark(opts: { image: Uint8Array; jobId: string }): Promise<Buffer> {
  if (!tileBuffer) {
    throw new Error('WatermarkService not initialized');
  }

  const { image } = opts;
  const baseImage = sharp(image);
  const metadata = await baseImage.metadata();
  const baseWidth = metadata.width ?? 1024;
  const baseHeight = metadata.height ?? 1024;

  // We tile the pre-rendered tileBuffer across the entire baseImage.
  // Using sharp's extend with 'repeat' to create a repeating pattern
  // large enough to cover the base image.
  const repeatedTile = await sharp(tileBuffer)
    .extend({
      top: 0,
      left: 0,
      bottom: Math.max(0, baseHeight - tileHeight),
      right: Math.max(0, baseWidth - tileWidth),
      extendWith: 'repeat',
    })
    .png()
    .toBuffer();

  return baseImage
    .composite([
      {
        input: repeatedTile,
        top: 0,
        left: 0,
        blend: 'over',
      },
    ])
    .png()
    .toBuffer();
}
