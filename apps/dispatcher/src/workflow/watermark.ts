import { createHash } from 'node:crypto';
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
  // Materialize to a buffer before reading dimensions — .metadata() on a
  // pipeline reflects the SOURCE image, not the post-resize/rotate output, so
  // sizing the tile canvas from it undersizes the canvas and .composite()
  // throws ("Image to composite must have same dimensions or smaller").
  const logoBuffer = await sharp(logoBytes)
    .resize({ width: 200 })
    .rotate(-35, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const logoMetadata = await sharp(logoBuffer).metadata();
  const width = logoMetadata.width ?? 200;
  const height = logoMetadata.height ?? 200;

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
        input: logoBuffer,
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
 * Deterministic tile offset seeded from jobId, so every image gets a
 * unique-looking layout without re-rendering the pattern geometry.
 */
export function tileOffsetForJob(jobId: string): { x: number; y: number } {
  const hash = createHash('sha256').update(jobId).digest();
  const x = tileWidth > 0 ? hash.readUInt32BE(0) % tileWidth : 0;
  const y = tileHeight > 0 ? hash.readUInt32BE(4) % tileHeight : 0;
  return { x, y };
}

/**
 * Applies the watermark tile across the target image canvas.
 */
export async function applyWatermark(opts: { image: Uint8Array; jobId: string }): Promise<Buffer> {
  if (!tileBuffer) {
    throw new Error('WatermarkService not initialized');
  }

  const { image, jobId } = opts;
  const baseImage = sharp(image);
  const metadata = await baseImage.metadata();
  const baseWidth = metadata.width ?? 1024;
  const baseHeight = metadata.height ?? 1024;
  const { x: offsetX, y: offsetY } = tileOffsetForJob(jobId);

  // We tile the pre-rendered tileBuffer across the entire baseImage, offset by
  // a jobId-seeded amount so the pattern doesn't land identically on every
  // image. Extend on all four sides by the offset (plus enough to cover the
  // canvas) then crop back to the base dimensions from the offset origin.
  // Materialized as two separate toBuffer() calls, not chained — chaining
  // .extend({ extendWith: 'repeat' }) directly into .extract() in one sharp
  // pipeline throws "bad extract area" in this sharp version even when the
  // extended buffer is provably large enough.
  const extendedTile = await sharp(tileBuffer)
    .extend({
      top: offsetY,
      left: offsetX,
      bottom: Math.max(0, baseHeight - tileHeight) + tileHeight,
      right: Math.max(0, baseWidth - tileWidth) + tileWidth,
      extendWith: 'repeat',
    })
    .png()
    .toBuffer();
  const repeatedTile = await sharp(extendedTile)
    .extract({ left: 0, top: 0, width: baseWidth, height: baseHeight })
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
