import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  DevCategoriesResponse,
  DevErrorResponse,
  DevJobParams,
  DevJobResponse,
  DevTryonJsonBody,
  DevTryonResponse,
  JOB_SOURCE,
} from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { sniffImageMime } from '../dev/image-sniff.js';
import { createExtensionTryonJob } from './create-job.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

/**
 * Routes for the shopper-facing Chrome extension (apps/chrome-extension — see
 * its PLAN.md). Authenticated with requireUser (the platform user's own JWT,
 * same as the web app), never an API key — the shopper is using their own Ai
 * Vastra account, not a merchant integration. Deliberately tagged 'extension',
 * not 'dev': these are not part of the public third-party dev-API surface
 * (server.ts's swagger transform hides anything not tagged 'dev').
 */
export async function extensionRoutes(app: FastifyInstance) {
  app.get(
    '/v1/extension/categories',
    {
      preHandler: app.requireUser,
      schema: {
        tags: ['extension'],
        summary: 'List try-on categories available to the Chrome extension',
        response: { 200: DevCategoriesResponse, 401: DevErrorResponse },
      },
    },
    async () => {
      const rows = await app.db
        .select({ slug: schema.devTryonCategories.slug, name: schema.devTryonCategories.name })
        .from(schema.devTryonCategories)
        .where(eq(schema.devTryonCategories.isActive, true))
        .orderBy(asc(schema.devTryonCategories.sortOrder));
      return { categories: rows };
    },
  );

  app.post(
    '/v1/extension/tryon',
    {
      preHandler: app.requireUser,
      // Same reasoning as /v1/dev/tryon: base64 inflates each 20MB image to
      // ~26.8MB of JSON text, above Fastify's 1MB default body limit.
      // Multipart is unaffected — @fastify/multipart streams via its own
      // fileSize limit below, not this.
      bodyLimit: 60 * 1024 * 1024,
      attachValidation: true,
      schema: {
        tags: ['extension'],
        summary: 'Create a try-on job from the Chrome extension',
        description:
          'Upload a person image and a garment image, either as multipart/form-data ' +
          '(fields: category, person, garment) or as a JSON body with base64-encoded ' +
          'images (fields: category, person, garment — plain base64 or a data: URI). ' +
          'Returns a job id to poll via GET /v1/extension/jobs/:id.',
        consumes: ['multipart/form-data', 'application/json'],
        body: DevTryonJsonBody,
        response: {
          202: DevTryonResponse,
          400: DevErrorResponse,
          401: DevErrorResponse,
          402: DevErrorResponse,
          403: DevErrorResponse,
          429: DevErrorResponse,
          503: DevErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const userId = req.userId;
      const maxFileBytes = await getUploadLimitBytes(req.server, 'webGarmentMaxBytes');

      let categorySlug: string | undefined;
      const files: Record<string, { buf: Buffer; mime: string }> = {};

      const isJson = (req.headers['content-type'] ?? '').startsWith('application/json');

      if (isJson) {
        const parsed = DevTryonJsonBody.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION',
            400,
            parsed.error.issues[0]?.message ?? 'invalid request body',
          );
        }
        categorySlug = parsed.data.category;
        for (const fieldname of ['person', 'garment'] as const) {
          const raw = parsed.data[fieldname].replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(raw, 'base64');
          if (buf.length === 0 || buf.length > maxFileBytes) {
            throw new AppError(
              'VALIDATION',
              400,
              `${fieldname} exceeds the ${maxFileBytes / (1024 * 1024)}MB limit`,
            );
          }
          const mime = sniffImageMime(buf);
          if (!mime) {
            throw new AppError(
              'VALIDATION',
              400,
              `${fieldname} must be a JPEG, PNG, or WebP image`,
            );
          }
          files[fieldname] = { buf, mime };
        }
      } else {
        const parts = req.parts({ limits: { fileSize: maxFileBytes, files: 2 } });
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
            throw new AppError(
              'VALIDATION',
              400,
              `${part.fieldname} exceeds the ${maxFileBytes / (1024 * 1024)}MB limit`,
            );
          });
          if (part.file.truncated) {
            throw new AppError(
              'VALIDATION',
              400,
              `${part.fieldname} exceeds the ${maxFileBytes / (1024 * 1024)}MB limit`,
            );
          }
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
      }

      if (!categorySlug) throw new AppError('VALIDATION', 400, 'category is required');
      if (!files.person) throw new AppError('VALIDATION', 400, 'person image is required');
      if (!files.garment) throw new AppError('VALIDATION', 400, 'garment image is required');

      // Upload before the credit transaction: an orphaned R2 object on a later
      // failure is harmless, a charge for a job whose inputs are missing is not.
      const personKey = keys.extensionUpload(
        userId,
        randomUUID(),
        EXT_BY_MIME[files.person.mime as keyof typeof EXT_BY_MIME],
      );
      const garmentKey = keys.extensionUpload(
        userId,
        randomUUID(),
        EXT_BY_MIME[files.garment.mime as keyof typeof EXT_BY_MIME],
      );
      await Promise.all([
        app.storage.putObject(personKey, files.person.buf, files.person.mime),
        app.storage.putObject(garmentKey, files.garment.buf, files.garment.mime),
      ]);

      const { jobId } = await createExtensionTryonJob(app, {
        userId,
        categorySlug,
        personKey,
        garmentKey,
      });

      return reply.code(202).send({ jobId, status: 'QUEUED', personKey });
    },
  );

  app.get(
    '/v1/extension/jobs/:id',
    {
      preHandler: app.requireUser,
      schema: {
        tags: ['extension'],
        summary: 'Get a Chrome-extension try-on job status and result',
        params: DevJobParams,
        response: { 200: DevJobResponse, 401: DevErrorResponse, 404: DevErrorResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          userId: schema.jobs.userId,
          outputKey: schema.jobOutputs.resultKey,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.source, JOB_SOURCE.EXTENSION_TRYON)))
        .limit(1);

      // 404 (not 403) on someone else's job so job IDs are not enumerable.
      if (!job || job.userId !== req.userId) {
        throw new AppError('NOT_FOUND', 404, 'job not found');
      }

      if (job.status === 'COMPLETED' && job.outputKey) {
        const { url } = await app.storage.presignGet(job.outputKey, 900);
        return { jobId: job.id, status: 'COMPLETED' as const, imageUrl: url };
      }
      if (job.status === 'FAILED') {
        return { jobId: job.id, status: 'FAILED' as const, error: job.errorCode ?? 'JOB_FAILED' };
      }
      if (job.status === 'CANCELLED') {
        return { jobId: job.id, status: 'FAILED' as const, error: 'JOB_CANCELLED' };
      }
      return {
        jobId: job.id,
        status: job.status === 'QUEUED' ? ('QUEUED' as const) : ('RUNNING' as const),
      };
    },
  );
}
