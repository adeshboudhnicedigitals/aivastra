import sharp from 'sharp';

// WhatsApp's image limit. Results are 4096px PNGs that run 7–8 MB, which Meta
// rejects at upload with (#100) "File too large" — and delivery would then
// retry the same run on every tick without ever sending it.
export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png']);
// Tried in order until one fits. 2560px still reads as full quality on a phone.
const ATTEMPTS = [
  { quality: 90 },
  { quality: 80 },
  { quality: 80, maxPx: 2560 },
  { quality: 70, maxPx: 2048 },
];

/**
 * The bytes to upload for one result: unchanged when WhatsApp accepts them as
 * they are, otherwise a JPEG under the limit. The full-resolution original
 * stays on the web (/catalogs); this only shapes the chat copy.
 */
export async function fitForWhatsapp(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (ACCEPTED.has(mimeType) && bytes.length <= WHATSAPP_IMAGE_MAX_BYTES) {
    return { bytes, mimeType };
  }
  let out = bytes;
  for (const a of ATTEMPTS) {
    let img = sharp(bytes).flatten({ background: '#ffffff' });
    if (a.maxPx) img = img.resize(a.maxPx, a.maxPx, { fit: 'inside', withoutEnlargement: true });
    out = await img.jpeg({ quality: a.quality, mozjpeg: true }).toBuffer();
    if (out.length <= WHATSAPP_IMAGE_MAX_BYTES) break;
  }
  return { bytes: out, mimeType: 'image/jpeg' };
}
