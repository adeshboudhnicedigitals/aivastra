import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  ConfirmMyBackgroundBody,
  CreateMyBackgroundFromUrlBody,
  PresignMyBackgroundBody,
} from '@aivastra/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { fetchImageWithCap } from '../../lib/fetch-image.js';
import { assertPublicHttpUrl } from '../../lib/ssrf-guard.js';

const UPLOAD_OWNER_TTL_SEC = 24 * 60 * 60;
const MAX_URL_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

async function makeThumb(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

function toItem(app: FastifyInstance, row: { id: string; label: string; thumbnailKey: string }) {
  return { id: row.id, label: row.label, thumbnailUrl: app.storage.publicUrl(row.thumbnailKey) };
}

const BACKGROUND_ROW_COLUMNS = {
  id: schema.modelBackgrounds.id,
  label: schema.modelBackgrounds.label,
  thumbnailKey: schema.modelBackgrounds.thumbnailKey,
};

export async function backgroundsRoutes(app: FastifyInstance) {
  app.get('/v1/backgrounds/mine', { preHandler: app.requireUser }, async (req) => {
    const rows = await app.db
      .select(BACKGROUND_ROW_COLUMNS)
      .from(schema.modelBackgrounds)
      .where(
        and(
          eq(schema.modelBackgrounds.scope, 'user'),
          eq(schema.modelBackgrounds.userId, req.userId),
          isNull(schema.modelBackgrounds.deletedAt),
        ),
      )
      .orderBy(desc(schema.modelBackgrounds.createdAt));
    return { items: rows.map((r) => toItem(app, r)) };
  });

  app.post(
    '/v1/backgrounds/mine/presign',
    { preHandler: app.requireUser, schema: { body: PresignMyBackgroundBody } },
    async (req) => {
      const { contentType, contentLength } = req.body as z.infer<typeof PresignMyBackgroundBody>;
      const id = randomUUID();
      const r2Key = keys.userBackground(req.userId, id);
      const { url, expiresIn } = await app.storage.presignPut(
        r2Key,
        contentType,
        contentLength,
        300,
      );
      await app.redis.set(`upload:owner:${r2Key}`, req.userId, 'EX', UPLOAD_OWNER_TTL_SEC);
      return { uploadUrl: url, r2Key, id, expiresIn };
    },
  );

  app.post(
    '/v1/backgrounds/mine/confirm',
    { preHandler: app.requireUser, schema: { body: ConfirmMyBackgroundBody } },
    async (req) => {
      const { r2Key, label } = req.body as z.infer<typeof ConfirmMyBackgroundBody>;
      const owner = await app.redis.get(`upload:owner:${r2Key}`);
      if (owner !== req.userId) {
        throw new AppError('FORBIDDEN', 403, 'upload key not owned by caller');
      }
      let buf: Buffer;
      try {
        buf = await app.storage.getObject(r2Key);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded background not found');
      }
      let thumb: Buffer;
      try {
        thumb = await makeThumb(buf);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded file is not a valid image');
      }
      const thumbnailKey = r2Key.replace(/\.jpg$/, '.thumb.jpg');
      await app.storage.putObject(thumbnailKey, thumb, 'image/jpeg');
      const [row] = await app.db
        .insert(schema.modelBackgrounds)
        .values({
          label: label ?? 'My background',
          r2Key,
          thumbnailKey,
          scope: 'user',
          userId: req.userId,
        })
        .returning();
      return toItem(app, row);
    },
  );

  app.post(
    '/v1/backgrounds/mine/from-url',
    { preHandler: app.requireUser, schema: { body: CreateMyBackgroundFromUrlBody } },
    async (req) => {
      const { url, label } = req.body as z.infer<typeof CreateMyBackgroundFromUrlBody>;
      const parsedUrl = await assertPublicHttpUrl(url);
      const buf = await fetchImageWithCap(parsedUrl, MAX_URL_IMAGE_BYTES, 10_000);
      let format: string | undefined;
      try {
        format = (await sharp(buf).metadata()).format;
      } catch {
        throw new AppError('VALIDATION', 400, 'url did not return a valid image');
      }
      if (!format || !ALLOWED_FORMATS.has(format)) {
        throw new AppError('VALIDATION', 400, 'unsupported image format');
      }
      const id = randomUUID();
      const r2Key = keys.userBackground(req.userId, id);
      const thumbnailKey = keys.userBackgroundThumb(req.userId, id);
      const normalized = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
      await app.storage.putObject(r2Key, normalized, 'image/jpeg');
      const thumb = await makeThumb(buf);
      await app.storage.putObject(thumbnailKey, thumb, 'image/jpeg');
      const [row] = await app.db
        .insert(schema.modelBackgrounds)
        .values({
          label: label ?? 'My background',
          r2Key,
          thumbnailKey,
          scope: 'user',
          userId: req.userId,
        })
        .returning();
      return toItem(app, row);
    },
  );

  app.delete(
    '/v1/backgrounds/mine/:id',
    { preHandler: app.requireUser, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .update(schema.modelBackgrounds)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.modelBackgrounds.id, id),
            eq(schema.modelBackgrounds.scope, 'user'),
            eq(schema.modelBackgrounds.userId, req.userId),
            isNull(schema.modelBackgrounds.deletedAt),
          ),
        )
        .returning({ id: schema.modelBackgrounds.id });
      if (!row) throw new AppError('NOT_FOUND', 404, 'background not found');
      return { deleted: true };
    },
  );
}
