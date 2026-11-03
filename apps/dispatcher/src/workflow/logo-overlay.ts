import sharp from 'sharp';

/** Logo width as a share of the result's width, clamped so it never dwarfs or vanishes. */
const LOGO_WIDTH_RATIO = 0.16;
const LOGO_MIN_WIDTH = 48;
const LOGO_MAX_WIDTH = 320;
/** Gap from the top and right edges, as a share of the result's width. */
const MARGIN_RATIO = 0.03;

/**
 * Composites a merchant's logo onto the top-right corner of a try-on result.
 * Keeps the logo's aspect ratio (fit: inside a square box) so wide wordmarks and
 * square marks both land at a sensible size. Returns PNG; the caller re-encodes.
 */
export async function overlayMerchantLogo(opts: {
  image: Uint8Array;
  logo: Uint8Array;
}): Promise<Buffer> {
  const base = sharp(opts.image);
  const { width = 1024, height = 1024 } = await base.metadata();

  const box = Math.round(
    Math.min(LOGO_MAX_WIDTH, Math.max(LOGO_MIN_WIDTH, width * LOGO_WIDTH_RATIO)),
  );
  const logoPng = await sharp(opts.logo)
    .rotate()
    .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logoPng).metadata();
  const logoWidth = logoMeta.width ?? box;
  const logoHeight = logoMeta.height ?? box;

  const margin = Math.round(width * MARGIN_RATIO);
  return base
    .composite([
      {
        input: logoPng,
        left: Math.max(0, width - logoWidth - margin),
        top: Math.min(margin, Math.max(0, height - logoHeight)),
        blend: 'over',
      },
    ])
    .png()
    .toBuffer();
}
