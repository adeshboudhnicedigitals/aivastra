import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { avatarUrlFor } from '../../lib/avatar.js';
import { AppError } from '../../lib/errors.js';

const UPLOAD_OWNER_TTL_SEC = 60 * 60;
// The presigned PUT cannot enforce a size (see r2.ts presignPut), so confirm
// re-checks it via headObject before the object is read into API memory.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_PX = 512;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

const PresignBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z.number().int().positive().max(MAX_AVATAR_BYTES),
});
const ConfirmBody = z.object({ key: z.string().min(1).max(300) });

export async function avatarRoutes(app: FastifyInstance) {
  app.post(
    '/v1/me/avatar/presign',
    { preHandler: app.requireUser, schema: { body: PresignBody } },
    async (req) => {
      const { contentType, contentLength } = req.body as z.infer<typeof PresignBody>;
      const key = keys.userAvatar(req.userId, randomUUID());
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 300);
      await app.redis.set(`upload:owner:${key}`, req.userId, 'EX', UPLOAD_OWNER_TTL_SEC);
      return { uploadUrl: url, key, expiresIn };
    },
  );

  app.post(
    '/v1/me/avatar/confirm',
    { preHandler: app.requireUser, schema: { body: ConfirmBody } },
    async (req) => {
      const { key } = req.body as z.infer<typeof ConfirmBody>;
      // Both checks: the redis binding proves this user was issued the key, the
      // prefix proves it can only ever be an avatar object — never another
      // user's, or an internal asset key smuggled in as the picture.
      const owner = await app.redis.get(`upload:owner:${key}`);
      if (owner !== req.userId || !key.startsWith(keys.userAvatarPrefix(req.userId))) {
        throw new AppError('FORBIDDEN', 403, 'upload key not owned by caller');
      }
      let head: { contentLength: number };
      try {
        head = await app.storage.headObject(key);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded picture not found');
      }
      if (head.contentLength > MAX_AVATAR_BYTES) {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded file exceeds size limit');
      }

      const raw = await app.storage.getObject(key);
      let format: string | undefined;
      try {
        format = (await sharp(raw).metadata()).format;
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded file is not a valid image');
      }
      if (!format || !ALLOWED_FORMATS.has(format)) {
        throw new AppError('BAD_UPLOAD', 400, 'unsupported image format');
      }
      // Re-encode from decoded pixels (never trust the caller's Content-Type or
      // keep their bytes): square crop, EXIF orientation applied, metadata dropped.
      const normalized = await sharp(raw)
        .rotate()
        .resize({ width: AVATAR_PX, height: AVATAR_PX, fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
      await app.storage.putObject(key, normalized, 'image/jpeg');

      const [prev] = await app.db
        .select({ avatarKey: schema.users.avatarKey })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      await app.db
        .update(schema.users)
        .set({ avatarKey: key, updatedAt: new Date() })
        .where(eq(schema.users.id, req.userId));
      await app.redis.del(`upload:owner:${key}`);
      // Best effort — an orphaned old picture is harmless, a failed confirm is not.
      if (prev?.avatarKey && prev.avatarKey !== key) {
        await app.storage.deleteObject(prev.avatarKey).catch((err) => {
          req.log.warn({ err, key: prev.avatarKey }, 'failed to delete replaced avatar');
        });
      }
      return { avatarUrl: await avatarUrlFor(app, key) };
    },
  );

  app.delete('/v1/me/avatar', { preHandler: app.requireUser }, async (req) => {
    const [prev] = await app.db
      .select({ avatarKey: schema.users.avatarKey })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId));
    await app.db
      .update(schema.users)
      .set({ avatarKey: null, updatedAt: new Date() })
      .where(eq(schema.users.id, req.userId));
    if (prev?.avatarKey) {
      await app.storage.deleteObject(prev.avatarKey).catch((err) => {
        req.log.warn({ err, key: prev.avatarKey }, 'failed to delete avatar');
      });
    }
    return { avatarUrl: null };
  });
}
