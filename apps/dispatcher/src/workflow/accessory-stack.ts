import sharp from 'sharp';

/**
 * Vertically concatenates admin-curated accessory images into one composite —
 * a plain top-to-bottom stack (y-axis), never an overlay/z-axis composite.
 * Images are resized to the widest input's width (preserving aspect ratio)
 * before stacking, since admin-uploaded accessory images are expected to
 * share a close-to-common width but aren't guaranteed to match exactly. See
 * docs/superpowers/specs/2026-10-01-accessory-images-design.md.
 */
export async function stackAccessoryImages(images: Buffer[]): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error('stackAccessoryImages requires at least one image');
  }

  const metas = await Promise.all(images.map((img) => sharp(img).metadata()));
  const targetWidth = Math.max(...metas.map((m) => m.width ?? 0));
  if (targetWidth <= 0) {
    throw new Error('stackAccessoryImages: could not read image dimensions');
  }

  const layers = await Promise.all(
    images.map(async (img, i) => {
      const meta = metas[i];
      if (meta?.width === targetWidth) {
        return { buffer: img, height: meta.height ?? 0 };
      }
      const resized = await sharp(img).resize({ width: targetWidth }).toBuffer();
      const resizedMeta = await sharp(resized).metadata();
      return { buffer: resized, height: resizedMeta.height ?? 0 };
    }),
  );

  const totalHeight = layers.reduce((sum, layer) => sum + layer.height, 0);

  let top = 0;
  const composites = layers.map((layer) => {
    const entry = { input: layer.buffer, top, left: 0 };
    top += layer.height;
    return entry;
  });

  return sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
