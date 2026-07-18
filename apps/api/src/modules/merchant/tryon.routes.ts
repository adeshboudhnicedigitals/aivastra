import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { MerchantTryonJobCreateBody, MerchantTryonPresignBody } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createMerchantTryonJob } from './create-tryon-job.js';

const MAX_TRYON_UPLOAD_BYTES = 10 * 1024 * 1024;

async function loadOwnedJob(app: FastifyInstance, merchantId: string, id: string) {
  const [job] = await app.db
    .select({
      id: schema.jobs.id,
      status: schema.jobs.status,
      merchantId: schema.jobs.merchantId,
      creditsCharged: schema.jobs.creditsCharged,
      resultKey: schema.jobOutputs.resultKey,
      errorCode: schema.jobs.errorCode,
      createdAt: schema.jobs.createdAt,
      completedAt: schema.jobs.completedAt,
    })
    .from(schema.jobs)
    .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
    .where(eq(schema.jobs.id, id))
    .limit(1);

  if (!job || job.merchantId !== merchantId) {
    throw new AppError('NOT_FOUND', 404, 'job not found');
  }
  return job;
}

async function serializeJob(app: FastifyInstance, merchantId: string, id: string) {
  const job = await loadOwnedJob(app, merchantId, id);
  const [liked, inCart] = await Promise.all([
    app.db
      .select({ id: schema.kioskResultLikes.id })
      .from(schema.kioskResultLikes)
      .where(
        and(
          eq(schema.kioskResultLikes.jobId, id),
          eq(schema.kioskResultLikes.merchantId, merchantId),
        ),
      )
      .limit(1),
    app.db
      .select({ id: schema.kioskResultCartItems.id })
      .from(schema.kioskResultCartItems)
      .where(
        and(
          eq(schema.kioskResultCartItems.jobId, id),
          eq(schema.kioskResultCartItems.merchantId, merchantId),
        ),
      )
      .limit(1),
  ]);

  let shareUrl: string | null = null;
  if (job.status === 'COMPLETED' && job.resultKey) {
    shareUrl = await app.storage
      .presignGet(job.resultKey, 86_400)
      .then((result) => result.url)
      .catch(() => null);
  }

  return {
    id: job.id,
    status: job.status,
    merchantId: job.merchantId,
    resultKey: job.resultKey,
    shareUrl,
    errorCode: job.errorCode,
    liked: liked.length > 0,
    inCart: inCart.length > 0,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function merchantTryonRoutes(app: FastifyInstance) {
  app.post(
    '/v1/merchant/tryon/presign',
    { preHandler: app.requireMerchant, schema: { body: MerchantTryonPresignBody } },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { contentType, contentLength } = req.body as z.infer<typeof MerchantTryonPresignBody>;
      const ext = contentType.split('/')[1] ?? 'jpg';
      const key = `merchant-inputs/${merchantId}/${randomUUID()}/photo.${ext}`;
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, merchantId, 'EX', 600);

      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.get(
    '/v1/merchant/tryon/photo-url',
    {
      preHandler: app.requireMerchant,
      schema: { querystring: z.object({ r2Key: z.string().min(1) }) },
    },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { r2Key } = req.query as { r2Key: string };
      if (!r2Key.startsWith(`merchant-inputs/${merchantId}/`)) {
        throw new AppError('FORBIDDEN', 403, 'photo key does not belong to this merchant');
      }
      const { url } = await app.storage.presignGet(r2Key, 300);
      return { url };
    },
  );
  app.post(
    '/v1/merchant/tryon/jobs',
    { preHandler: app.requireMerchant, schema: { body: MerchantTryonJobCreateBody } },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { merchantCatalogItemId, customerPhotoKey } = req.body as z.infer<
        typeof MerchantTryonJobCreateBody
      >;

      const [item] = await app.db
        .select({
          id: schema.merchantCatalogItems.id,
          merchantId: schema.merchantCatalogItems.merchantId,
          r2Key: schema.merchantCatalogItems.r2Key,
          isActive: schema.merchantCatalogItems.isActive,
          moderationStatus: schema.merchantCatalogItems.moderationStatus,
          workflowTemplateId: schema.tryonCategories.workflowTemplateId,
          tryonCategoryIsActive: schema.tryonCategories.isActive,
          workflowTemplateIsActive: schema.workflowTemplates.isActive,
        })
        .from(schema.merchantCatalogItems)
        .innerJoin(
          schema.merchantCatalogSubcategories,
          eq(schema.merchantCatalogSubcategories.id, schema.merchantCatalogItems.subcategoryId),
        )
        .leftJoin(
          schema.garmentSubcategories,
          eq(
            schema.garmentSubcategories.id,
            schema.merchantCatalogSubcategories.garmentSubcategoryId,
          ),
        )
        .leftJoin(
          schema.tryonCategories,
          eq(schema.tryonCategories.id, schema.garmentSubcategories.tryonCategoryId),
        )
        .leftJoin(
          schema.workflowTemplates,
          eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
        )
        .where(eq(schema.merchantCatalogItems.id, merchantCatalogItemId))
        .limit(1);

      if (!item || item.merchantId !== merchantId) {
        throw new AppError('NOT_FOUND', 404, 'catalog item not found');
      }
      if (!item.isActive || item.moderationStatus !== 'approved') {
        throw new AppError('FORBIDDEN', 403, 'catalog item is not available');
      }
      if (
        !item.workflowTemplateId ||
        !item.tryonCategoryIsActive ||
        !item.workflowTemplateIsActive
      ) {
        throw new AppError('VALIDATION', 400, 'garment type has no tryon category configured');
      }
      if (!customerPhotoKey.startsWith(`merchant-inputs/${merchantId}/`)) {
        throw new AppError('FORBIDDEN', 403, 'customer photo key does not belong to this merchant');
      }

      const uploadOwner = await app.redis.get(`upload:owner:${customerPhotoKey}`);
      if (uploadOwner !== merchantId) {
        throw new AppError('FORBIDDEN', 403, 'upload session expired or not owned');
      }

      let photoHead: { contentLength: number };
      try {
        photoHead = await app.storage.headObject(customerPhotoKey);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded photo not found');
      }
      if (photoHead.contentLength > MAX_TRYON_UPLOAD_BYTES) {
        throw new AppError('BAD_UPLOAD', 413, 'uploaded photo exceeds 5MB limit');
      }

      const [merchant] = await app.db
        .select({ userId: schema.merchants.userId })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, merchantId))
        .limit(1);
      if (!merchant) throw new AppError('NOT_FOUND', 404, 'merchant not found');

      const jobId = await createMerchantTryonJob(app, {
        merchantId,
        merchantUserId: merchant.userId,
        upperGarmentKey: item.r2Key,
        customerPhotoKey,
        workflowTemplateId: item.workflowTemplateId,
      });

      reply.code(201);
      return { jobId };
    },
  );
  app.get(
    '/v1/merchant/tryon/jobs/:id',
    { preHandler: app.requireMerchant, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      return serializeJob(app, merchantId, id);
    },
  );

  app.delete(
    '/v1/merchant/tryon/jobs/:id',
    { preHandler: app.requireMerchant, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      const job = await loadOwnedJob(app, merchantId, id);

      if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        throw new AppError('NOT_CANCELLABLE', 409, 'job is already finished or cancelled');
      }
      if (job.status === 'GENERATING' || job.status === 'UPLOADING') {
        throw new AppError('NOT_CANCELLABLE', 409, 'job is already being processed');
      }

      await app.db.update(schema.jobs).set({ status: 'CANCELLED' }).where(eq(schema.jobs.id, id));

      const evt = JSON.stringify({ type: 'STATUS', jobId: id, status: 'CANCELLED' });
      await app.redis.publish(`sse:events:widget:${merchantId}`, evt);

      reply.code(200);
      return { status: 'CANCELLED' };
    },
  );
}
