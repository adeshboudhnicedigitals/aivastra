import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  DevBackgroundConfirmBody,
  DevBackgroundConfirmResponse,
  DevBackgroundDeleteResponse,
  DevBackgroundParams,
  DevBackgroundPresignBody,
  DevBackgroundPresignResponse,
  DevBackgroundsListResponse,
  DevErrorResponse,
} from '@aivastra/types';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { normalizeAndStoreBackground, toItem } from '../backgrounds/normalize.js';
import { hashApiKey } from './keys.js';

// Caps unbounded storage growth from a key: unlike job creation, an upload costs no
// credits, so nothing else naturally bounds how many a single merchant could create.
// Soft-deleted rows don't count, so delete-then-reupload is always available as relief.
const MAX_ACTIVE_DEV_BACKGROUNDS = 200;

const BACKGROUND_ROW_COLUMNS = {
  id: schema.modelBackgrounds.id,
  label: schema.modelBackgrounds.label,
  thumbnailKey: schema.modelBackgrounds.thumbnailKey,
};

/** Same per-key bucketing rationale as devCatalogRoutes/devRoutes: the limiter runs
 *  at onRequest, before auth populates req.apiKeyId. */
function keyGenerator(req: { headers: Record<string, unknown>; ip: string }) {
  const h = req.headers.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') ? hashApiKey(h.slice(7)) : req.ip;
}

const listRateLimit = { rateLimit: { max: 600, timeWindow: '1 minute', keyGenerator } };
// presign/confirm write to storage and the DB — tighter, matching
// /v1/backgrounds/mine/from-url's write-path limit.
const writeRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator } };

export async function devBackgroundsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/dev/backgrounds',
    {
      preHandler: [app.requireApiKey, app.requireDevScope('full')],
      config: listRateLimit,
      schema: {
        tags: ['dev'],
        summary: 'List your uploaded backgrounds',
        description:
          "Backgrounds you've uploaded via POST /v1/dev/backgrounds/confirm. Each " +
          "item's `id` is also its slug — pass it directly as `looks[].background` on " +
          'POST /v1/dev/catalog/generate, mixed freely with curated slugs from ' +
          'GET /v1/dev/catalog/options.',
        response: { 200: DevBackgroundsListResponse, 401: DevErrorResponse, 429: DevErrorResponse },
      },
    },
    async (req) => {
      const merchantUserId = req.merchantUserId as string;
      const rows = await app.db
        .select(BACKGROUND_ROW_COLUMNS)
        .from(schema.modelBackgrounds)
        .where(
          and(
            eq(schema.modelBackgrounds.scope, 'user'),
            eq(schema.modelBackgrounds.userId, merchantUserId),
            isNull(schema.modelBackgrounds.deletedAt),
          ),
        )
        .orderBy(desc(schema.modelBackgrounds.createdAt));
      return { items: await Promise.all(rows.map((r) => toItem(app, r))) };
    },
  );

  app.post(
    '/v1/dev/backgrounds/presign',
    {
      preHandler: [app.requireApiKey, app.requireDevScope('full')],
      config: writeRateLimit,
      schema: {
        tags: ['dev'],
        summary: 'Get a presigned upload URL for a new background',
        description:
          'PUT your image bytes to the returned `uploadUrl`, then call ' +
          'POST /v1/dev/backgrounds/confirm with the returned `r2Key` to finish.',
        body: DevBackgroundPresignBody,
        response: {
          200: DevBackgroundPresignResponse,
          400: DevErrorResponse,
          401: DevErrorResponse,
          403: DevErrorResponse,
          429: DevErrorResponse,
        },
      },
    },
    async (req) => {
      const merchantUserId = req.merchantUserId as string;
      const { contentType, contentLength } = req.body as z.infer<typeof DevBackgroundPresignBody>;
      const id = randomUUID();
      const r2Key = keys.userBackground(merchantUserId, id);
      const { url, expiresIn } = await app.storage.presignPut(
        r2Key,
        contentType,
        contentLength,
        300,
      );
      await app.redis.set(`upload:owner:${r2Key}`, merchantUserId, 'EX', 24 * 60 * 60);
      return { uploadUrl: url, r2Key, id, expiresIn };
    },
  );

  app.post(
    '/v1/dev/backgrounds/confirm',
    {
      preHandler: [app.requireApiKey, app.requireDevScope('full')],
      config: writeRateLimit,
      schema: {
        tags: ['dev'],
        summary: 'Finish a background upload',
        description:
          'Verifies the object you PUT to the presigned URL, normalizes it, and ' +
          'returns the item. The returned `id` is also its slug — usable directly as ' +
          '`looks[].background` on POST /v1/dev/catalog/generate.',
        body: DevBackgroundConfirmBody,
        response: {
          200: DevBackgroundConfirmResponse,
          400: DevErrorResponse,
          401: DevErrorResponse,
          403: DevErrorResponse,
          429: DevErrorResponse,
        },
      },
    },
    async (req) => {
      const merchantUserId = req.merchantUserId as string;
      const { r2Key, label } = req.body as z.infer<typeof DevBackgroundConfirmBody>;

      const owner = await app.redis.get(`upload:owner:${r2Key}`);
      if (owner !== merchantUserId) {
        throw new AppError('FORBIDDEN', 403, 'upload key not owned by caller');
      }

      const maxBytes = await getUploadLimitBytes(req.server, 'devApiMaxBytes');
      let head: { contentLength: number };
      try {
        head = await app.storage.headObject(r2Key);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded background not found');
      }
      if (head.contentLength > maxBytes) {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded file exceeds size limit');
      }

      const [{ value: activeCount }] = await app.db
        .select({ value: count() })
        .from(schema.modelBackgrounds)
        .where(
          and(
            eq(schema.modelBackgrounds.scope, 'user'),
            eq(schema.modelBackgrounds.userId, merchantUserId),
            isNull(schema.modelBackgrounds.deletedAt),
          ),
        );
      if (activeCount >= MAX_ACTIVE_DEV_BACKGROUNDS) {
        throw new AppError(
          'LIMIT_EXCEEDED',
          400,
          `you have reached the limit of ${MAX_ACTIVE_DEV_BACKGROUNDS} active backgrounds — ` +
            'delete an unused one via DELETE /v1/dev/backgrounds/:id before uploading another',
        );
      }

      const buf = await app.storage.getObject(r2Key);
      // keys.userBackground always emits `.jpg`, so this mirrors the platform-user
      // confirm route's derivation exactly — no separate thumb-key builder call needed.
      const thumbnailKey = r2Key.replace(/\.jpg$/, '.thumb.jpg');
      return normalizeAndStoreBackground(app, merchantUserId, buf, r2Key, thumbnailKey, label);
    },
  );

  app.delete(
    '/v1/dev/backgrounds/:id',
    {
      preHandler: [app.requireApiKey, app.requireDevScope('full')],
      config: writeRateLimit,
      schema: {
        tags: ['dev'],
        summary: 'Delete an uploaded background',
        params: DevBackgroundParams,
        response: {
          200: DevBackgroundDeleteResponse,
          401: DevErrorResponse,
          404: DevErrorResponse,
          429: DevErrorResponse,
        },
      },
    },
    async (req) => {
      const merchantUserId = req.merchantUserId as string;
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .update(schema.modelBackgrounds)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.modelBackgrounds.id, id),
            eq(schema.modelBackgrounds.scope, 'user'),
            eq(schema.modelBackgrounds.userId, merchantUserId),
            isNull(schema.modelBackgrounds.deletedAt),
          ),
        )
        .returning({ id: schema.modelBackgrounds.id });
      if (!row) throw new AppError('NOT_FOUND', 404, 'background not found');
      return { deleted: true };
    },
  );
}
