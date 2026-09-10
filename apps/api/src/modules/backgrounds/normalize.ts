import { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { AppError } from '../../lib/errors.js';

export const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function makeThumb(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

export async function toItem(
  app: FastifyInstance,
  row: { id: string; label: string; thumbnailKey: string },
) {
  return {
    id: row.id,
    label: row.label,
    thumbnailUrl: (await app.storage.presignGet(row.thumbnailKey, 3600)).url,
  };
}

/**
 * Shared "validate -> normalize -> store" pipeline, used by both the platform-user
 * /v1/backgrounds/mine/* routes and the dev-API /v1/dev/backgrounds/* routes — a
 * background is a background regardless of whether its owning `userId` came from a
 * session (req.userId) or a merchant's linked user (req.merchantUserId): sniff the
 * real format from bytes (never trust the caller-supplied Content-Type), reject
 * anything not in ALLOWED_FORMATS, re-encode to real JPEG, generate a thumbnail from
 * the original bytes, store both objects, and insert the DB row.
 */
export async function normalizeAndStoreBackground(
  app: FastifyInstance,
  userId: string,
  buf: Buffer,
  r2Key: string,
  thumbnailKey: string,
  label: string | undefined,
) {
  let format: string | undefined;
  try {
    format = (await sharp(buf).metadata()).format;
  } catch {
    throw new AppError('BAD_UPLOAD', 400, 'uploaded file is not a valid image');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw new AppError('BAD_UPLOAD', 400, 'unsupported image format');
  }
  const normalized = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
  const thumb = await makeThumb(buf);
  await app.storage.putObject(r2Key, normalized, 'image/jpeg');
  await app.storage.putObject(thumbnailKey, thumb, 'image/jpeg');
  const [row] = await app.db
    .insert(schema.modelBackgrounds)
    .values({
      label: label ?? 'My background',
      r2Key,
      thumbnailKey,
      scope: 'user',
      userId,
    })
    .returning();
  return await toItem(app, row);
}
