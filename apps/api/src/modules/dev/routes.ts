import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { createDevTryonJob } from './create-job.js';
import { sniffImageMime } from './image-sniff.js';
import { hashApiKey } from './keys.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

// The per-key limiter runs at onRequest, BEFORE preHandler auth — so req.apiKeyId
// is not populated yet. Hashing the raw bearer gives a stable per-key bucket with
// no DB hit and without ever using the raw key as a Redis key. Unauthenticated
// junk falls back to per-IP.
const rateLimitConfig = {
  rateLimit: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) => {
      const h = req.headers.authorization;
      return typeof h === 'string' && h.startsWith('Bearer ') ? hashApiKey(h.slice(7)) : req.ip;
    },
  },
};

export async function devRoutes(app: FastifyInstance) {
  app.post(
    '/v1/dev/tryon',
    { preHandler: app.requireApiKey, config: rateLimitConfig },
    async (req, reply) => {
      const merchantId = req.merchantId as string;
      const merchantUserId = req.merchantUserId as string;
      const apiKeyId = req.apiKeyId as string;

      let categorySlug: string | undefined;
      const files: Record<string, { buf: Buffer; mime: string }> = {};

      // The global multipart limit is 2.5GB (server.ts) for the admin zip-import
      // route, so this route MUST set its own limits — it does not inherit a safe
      // default.
      const parts = req.parts({ limits: { fileSize: MAX_FILE_BYTES, files: 2 } });
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'category') {
          categorySlug = String(part.value);
          continue;
        }
        if (part.type !== 'file') continue;
        if (part.fieldname !== 'person' && part.fieldname !== 'garment') {
          throw new AppError('VALIDATION', 400, `unexpected file field: ${part.fieldname}`);
        }
        const buf = await part.toBuffer().catch(() => {
          throw new AppError('VALIDATION', 400, `${part.fieldname} exceeds the 10MB limit`);
        });
        if (part.file.truncated) {
          throw new AppError('VALIDATION', 400, `${part.fieldname} exceeds the 10MB limit`);
        }
        // Magic bytes only — part.mimetype is client-declared and untrusted.
        const mime = sniffImageMime(buf);
        if (!mime) {
          throw new AppError(
            'VALIDATION',
            400,
            `${part.fieldname} must be a JPEG, PNG, or WebP image`,
          );
        }
        files[part.fieldname] = { buf, mime };
      }

      if (!categorySlug) throw new AppError('VALIDATION', 400, 'category is required');
      if (!files.person) throw new AppError('VALIDATION', 400, 'person image is required');
      if (!files.garment) throw new AppError('VALIDATION', 400, 'garment image is required');

      // Upload before the credit transaction: an orphaned R2 object on a later
      // failure is harmless, a charge for a job whose inputs are missing is not.
      const personKey = keys.devUpload(
        merchantId,
        randomUUID(),
        EXT_BY_MIME[files.person.mime as keyof typeof EXT_BY_MIME],
      );
      const garmentKey = keys.devUpload(
        merchantId,
        randomUUID(),
        EXT_BY_MIME[files.garment.mime as keyof typeof EXT_BY_MIME],
      );
      await Promise.all([
        app.storage.putObject(personKey, files.person.buf, files.person.mime),
        app.storage.putObject(garmentKey, files.garment.buf, files.garment.mime),
      ]);

      const { jobId } = await createDevTryonJob(app, {
        merchantId,
        merchantUserId,
        apiKeyId,
        categorySlug,
        personKey,
        garmentKey,
      });

      return reply.code(202).send({ jobId, status: 'QUEUED' });
    },
  );
}
