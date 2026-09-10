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
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { fetchImageWithCap } from '../../lib/fetch-image.js';
import { isPinterestUrl, resolvePinterestImageUrl } from '../../lib/pinterest-resolver.js';
import { assertPublicHttpUrl } from '../../lib/ssrf-guard.js';
import { normalizeAndStoreBackground, toItem } from './normalize.js';

const UPLOAD_OWNER_TTL_SEC = 24 * 60 * 60;
const MAX_URL_IMAGE_BYTES = 15 * 1024 * 1024;
// Matches PresignMyBackgroundBody.contentLength's max in packages/types/src/backgrounds.ts.
// The presigned PUT does not enforce this at R2 (see r2.ts presignPut comment), so it must be
// re-checked here via headObject before the object is ever read into API memory.
const MAX_CONFIRM_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    return { items: await Promise.all(rows.map((r) => toItem(app, r))) };
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
      let head: { contentLength: number };
      try {
        head = await app.storage.headObject(r2Key);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded background not found');
      }
      if (head.contentLength > MAX_CONFIRM_UPLOAD_BYTES) {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded file exceeds size limit');
      }
      const buf = await app.storage.getObject(r2Key);
      const thumbnailKey = r2Key.replace(/\.jpg$/, '.thumb.jpg');
      return normalizeAndStoreBackground(app, req.userId, buf, r2Key, thumbnailKey, label);
    },
  );

  app.post(
    '/v1/backgrounds/mine/from-url',
    {
      preHandler: app.requireUser,
      schema: { body: CreateMyBackgroundFromUrlBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { url, label } = req.body as z.infer<typeof CreateMyBackgroundFromUrlBody>;
      let target = await assertPublicHttpUrl(url);
      if (isPinterestUrl(target.url)) {
        target = await resolvePinterestImageUrl(target);
      }
      const buf = await fetchImageWithCap(target.url, target.address, MAX_URL_IMAGE_BYTES, 10_000);
      const id = randomUUID();
      const r2Key = keys.userBackground(req.userId, id);
      const thumbnailKey = keys.userBackgroundThumb(req.userId, id);
      return normalizeAndStoreBackground(app, req.userId, buf, r2Key, thumbnailKey, label);
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
