import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { createShopifyStoreCatalogJob } from './catalog-job.js';
import { createProductMedia } from './catalog-publish.js';
import { fetchLiveProductImages } from './products.routes.js';
import { assertShopifyCdn } from './products.sync.js';
import { getValidAccessToken } from './token.js';

const GenerateBody = z.object({
  shopifyProductId: z.number().int().positive(),
  sourceImageUrl: z.string().url(),
  faceId: z.string().uuid(),
  garmentTypeId: z.string().uuid().optional(),
  looks: z
    .array(z.object({ poseId: z.string().uuid(), backgroundId: z.string().uuid() }))
    .min(1)
    .max(12),
  lowerCatalogId: z.string().uuid().optional(),
  shoeCatalogId: z.string().uuid().optional(),
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']),
  resolution: z.enum(['HD', '2K', '4K']),
});

const JobsQuery = z
  .object({
    catalogueId: z.string().uuid().optional(),
    shopifyProductId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => q.catalogueId !== undefined || q.shopifyProductId !== undefined, {
    message: 'catalogueId or shopifyProductId is required',
  });

/** Mirrors PATCH /v1/shopify/products/:id's download-to-R2 logic (products.routes.ts):
 *  admin-configured cap (default 20MB), 10s abort timeout, no-redirect fetch.
 *  Namespaced by store+product so concurrent generations across stores/products
 *  never collide on the same key. */
async function downloadProductImageToR2(
  app: FastifyInstance,
  storeId: string,
  shopifyProductId: number,
  sourceImageUrl: string,
): Promise<string> {
  assertShopifyCdn(sourceImageUrl);
  const maxSourceBytes = await getUploadLimitBytes(app, 'shopifyCatalogSourceMaxBytes');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sourceImageUrl, { redirect: 'error', signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new AppError('SHOPIFY', 504, 'timed out downloading the selected product image');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new AppError('SHOPIFY', 502, 'failed to download the selected product image');
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxSourceBytes) {
    throw new AppError(
      'BAD_REQUEST',
      400,
      `source image exceeds ${maxSourceBytes / (1024 * 1024)}MB`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxSourceBytes) {
    throw new AppError(
      'BAD_REQUEST',
      400,
      `source image exceeds ${maxSourceBytes / (1024 * 1024)}MB`,
    );
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const r2Key = `shopify-catalog-garments/${storeId}/${shopifyProductId}/${randomUUID()}.jpg`;
  await app.storage.putObject(r2Key, Buffer.from(arrayBuffer), contentType);
  return r2Key;
}

export async function shopifyCatalogRoutes(app: FastifyInstance) {
  app.post(
    '/v1/shopify/catalog/generate',
    // preHandler (not preValidation): auth must run before Fastify's declarative
    // body-schema validation, or an unauthenticated request with a malformed/empty
    // body gets a 400 instead of the 401 it should — auth failure must never depend
    // on whether the caller also happened to send a well-formed body. Since there's
    // no declarative schema.body here, validation is done manually below, after auth.
    { preHandler: app.requireShopifySession },
    async (req, reply) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      let body: z.infer<typeof GenerateBody>;
      try {
        body = GenerateBody.parse(req.body);
      } catch (err) {
        throw new AppError(
          'VALIDATION',
          400,
          err instanceof Error ? err.message : 'invalid request body',
        );
      }

      // Confirm sourceImageUrl is actually one of the CURRENT images on this specific
      // product, not just any allowlisted Shopify CDN URL — mirrors the same check in
      // PATCH /v1/shopify/products/:id (products.routes.ts).
      const liveImages = await fetchLiveProductImages(app, store, String(body.shopifyProductId));
      if (!liveImages.some((img) => img.src === body.sourceImageUrl)) {
        throw new AppError(
          'BAD_REQUEST',
          400,
          "sourceImageUrl is not one of this product's current images",
        );
      }

      const r2Key = await downloadProductImageToR2(
        app,
        store.id,
        body.shopifyProductId,
        body.sourceImageUrl,
      );

      let jobResult: Awaited<ReturnType<typeof createShopifyStoreCatalogJob>>;
      try {
        jobResult = await createShopifyStoreCatalogJob(
          app,
          store,
          {
            inputs: {
              upperGarmentKey: r2Key,
              faceId: body.faceId,
              garmentTypeId: body.garmentTypeId,
              looks: body.looks,
              lowerCatalogId: body.lowerCatalogId,
              shoeCatalogId: body.shoeCatalogId,
            },
            aspectRatio: body.aspectRatio,
            resolution: body.resolution,
          },
          { trustedGarmentKeys: new Set([r2Key]) },
        );
      } catch (err) {
        await app.storage.deleteObject(r2Key).catch(() => {});
        throw err;
      }
      const { catalogueId, jobIds } = jobResult;

      // This tracking insert is deliberately NOT part of createJob's transaction — the
      // jobs are already committed, running, and billed by this point. If this insert
      // fails, we do not roll back createJob or refund credits (the underlying jobs are
      // real and valid); we only lose the ability to surface them in this UI. Log with
      // enough context to manually reconcile, then rethrow so the client sees an error
      // instead of a 201 for jobs it can never find via the jobs listing route.
      try {
        await app.db.insert(schema.shopifyCatalogJobs).values(
          jobIds.map((jobId) => ({
            jobId,
            storeId: store.id,
            shopifyProductId: body.shopifyProductId,
            sourceImageUrl: body.sourceImageUrl,
          })),
        );
      } catch (err) {
        app.log.error(
          { err, jobIds, catalogueId, storeId: store.id, shopifyProductId: body.shopifyProductId },
          'failed to insert shopifyCatalogJobs tracking rows after createJob succeeded — jobs are real, running, and billed, but untrackable via the catalog UI until manually reconciled',
        );
        throw err;
      }

      return reply.code(201).send({ catalogueId, jobIds });
    },
  );

  app.get(
    '/v1/shopify/catalog/jobs',
    // preHandler (not a declarative schema.querystring): same rationale as
    // /v1/shopify/catalog/generate above — auth must run before validation, or an
    // unauthenticated request with a malformed querystring gets 400 instead of 401.
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      let query: z.infer<typeof JobsQuery>;
      try {
        query = JobsQuery.parse(req.query);
      } catch (err) {
        throw new AppError(
          'VALIDATION',
          400,
          err instanceof Error ? err.message : 'invalid request querystring',
        );
      }
      const { catalogueId, shopifyProductId } = query;
      const scope = catalogueId
        ? eq(schema.jobs.catalogueId, catalogueId)
        : eq(schema.shopifyCatalogJobs.shopifyProductId, shopifyProductId as number);

      const rows = await app.db
        .select({
          jobId: schema.jobs.id,
          catalogueId: schema.jobs.catalogueId,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          resultKey: schema.jobOutputs.resultKey,
          shopifyMediaId: schema.shopifyCatalogJobs.shopifyMediaId,
          sourceImageUrl: schema.shopifyCatalogJobs.sourceImageUrl,
          createdAt: schema.shopifyCatalogJobs.createdAt,
        })
        .from(schema.jobs)
        .innerJoin(schema.shopifyCatalogJobs, eq(schema.shopifyCatalogJobs.jobId, schema.jobs.id))
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(and(scope, eq(schema.shopifyCatalogJobs.storeId, store.id)))
        .orderBy(desc(schema.shopifyCatalogJobs.createdAt));

      return {
        items: await Promise.all(
          rows.map(async (r) => ({
            jobId: r.jobId,
            catalogueId: r.catalogueId,
            status: r.status,
            errorCode: r.errorCode,
            resultUrl: r.resultKey ? (await app.storage.presignGet(r.resultKey, 3600)).url : null,
            published: r.shopifyMediaId != null,
            sourceImageUrl: r.sourceImageUrl,
            createdAt: r.createdAt,
          })),
        ),
      };
    },
  );

  app.post(
    '/v1/shopify/catalog/jobs/:id/publish',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id: jobId } = req.params as { id: string };

      const [tracked] = await app.db
        .select()
        .from(schema.shopifyCatalogJobs)
        .where(
          and(
            eq(schema.shopifyCatalogJobs.jobId, jobId),
            eq(schema.shopifyCatalogJobs.storeId, store.id),
          ),
        )
        .limit(1);
      if (!tracked) throw new AppError('NOT_FOUND', 404, 'catalog job not found');

      if (tracked.shopifyMediaId) {
        return { ok: true, mediaId: tracked.shopifyMediaId };
      }

      const [job] = await app.db
        .select({ status: schema.jobs.status })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId));
      if (job?.status !== 'COMPLETED') {
        throw new AppError('VALIDATION', 409, 'job has not completed yet');
      }

      const signed = await app.storage.presignGet(keys.output(jobId), 300);
      const accessToken = await getValidAccessToken(app, store);
      const mediaId = await createProductMedia(
        store.shopDomain,
        accessToken,
        tracked.shopifyProductId,
        signed.url,
      );

      await app.db
        .update(schema.shopifyCatalogJobs)
        .set({ shopifyMediaId: mediaId, publishedAt: new Date() })
        .where(eq(schema.shopifyCatalogJobs.jobId, jobId));

      return { ok: true, mediaId };
    },
  );
}
