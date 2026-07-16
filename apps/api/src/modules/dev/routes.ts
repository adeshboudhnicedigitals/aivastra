import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  DevCategoriesResponse,
  DevJobParams,
  DevJobResponse,
  DevMeResponse,
  DevTryonResponse,
} from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
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
    {
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'Create a try-on job',
        description:
          'Upload a person image and a garment image as multipart/form-data. Returns a job id to poll.',
        consumes: ['multipart/form-data'],
        response: { 202: DevTryonResponse },
      },
    },
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

  app.get(
    '/v1/dev/jobs/:id',
    {
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'Get try-on job status and result',
        params: DevJobParams,
        response: { 200: DevJobResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          merchantId: schema.jobs.merchantId,
          // NOTE: the column is `result_key` / resultKey — job_outputs has no r2Key.
          outputKey: schema.jobOutputs.resultKey,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.source, 'api')))
        .limit(1);

      // Scoped by merchant, not by key: a merchant that rotates keys must still be
      // able to read its older jobs. 404 (not 403) on someone else's job so job IDs
      // are not enumerable.
      if (!job || job.merchantId !== req.merchantId) {
        throw new AppError('NOT_FOUND', 404, 'job not found');
      }

      if (job.status === 'COMPLETED' && job.outputKey) {
        // Presigned + short-lived: API results stay private to the owning merchant.
        const { url } = await app.storage.presignGet(job.outputKey, 900);
        return { jobId: job.id, status: job.status, imageUrl: url };
      }
      if (job.status === 'FAILED') {
        return { jobId: job.id, status: job.status, error: job.errorCode ?? 'JOB_FAILED' };
      }
      return { jobId: job.id, status: job.status };
    },
  );

  app.get(
    '/v1/dev/categories',
    {
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'List try-on categories',
        response: { 200: DevCategoriesResponse },
      },
    },
    async () => {
      const rows = await app.db
        .select({ slug: schema.tryonCategories.slug, name: schema.tryonCategories.name })
        .from(schema.tryonCategories)
        .where(eq(schema.tryonCategories.isActive, true))
        .orderBy(asc(schema.tryonCategories.sortOrder));
      return { categories: rows };
    },
  );

  app.get(
    '/v1/dev/me',
    {
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: { tags: ['dev'], summary: 'Get account info', response: { 200: DevMeResponse } },
    },
    async (req) => {
      const [row] = await app.db
        .select({
          merchantId: schema.merchants.id,
          companyName: schema.merchants.companyName,
          credits: schema.userCredits.balance,
        })
        .from(schema.merchants)
        .leftJoin(schema.userCredits, eq(schema.userCredits.userId, schema.merchants.userId))
        .where(eq(schema.merchants.id, req.merchantId as string))
        .limit(1);
      if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');
      return {
        merchantId: row.merchantId,
        companyName: row.companyName,
        credits: row.credits ?? 0,
      };
    },
  );
}
