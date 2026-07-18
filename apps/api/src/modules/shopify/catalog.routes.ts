import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { createJob } from '../jobs/create.js';
import { createProductMedia } from './catalog-publish.js';
import { assertShopifyCdn } from './products.sync.js';

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

const MAX_GARMENT_SOURCE_BYTES = 10 * 1024 * 1024;

/** Mirrors PATCH /v1/shopify/products/:id's download-to-R2 logic (products.routes.ts):
 *  10MB cap, 10s abort timeout, no-redirect fetch. Namespaced by store+product so
 *  concurrent generations across stores/products never collide on the same key. */
async function downloadProductImageToR2(
  app: FastifyInstance,
  storeId: string,
  shopifyProductId: number,
  sourceImageUrl: string,
): Promise<string> {
  assertShopifyCdn(sourceImageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sourceImageUrl, { redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new AppError('SHOPIFY', 502, 'failed to download the selected product image');
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_GARMENT_SOURCE_BYTES) {
    throw new AppError('BAD_REQUEST', 400, 'source image exceeds 10MB');
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_GARMENT_SOURCE_BYTES) {
    throw new AppError('BAD_REQUEST', 400, 'source image exceeds 10MB');
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

      if (!store.ownerUserId) {
        throw new AppError('INSUFFICIENT_CREDITS', 402, 'Store is not linked to a billing account');
      }

      const r2Key = await downloadProductImageToR2(
        app,
        store.id,
        body.shopifyProductId,
        body.sourceImageUrl,
      );

      let jobResult: Awaited<ReturnType<typeof createJob>>;
      try {
        jobResult = await createJob(
          app,
          store.ownerUserId,
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

      await app.db.insert(schema.shopifyCatalogJobs).values(
        jobIds.map((jobId) => ({
          jobId,
          storeId: store.id,
          shopifyProductId: body.shopifyProductId,
          sourceImageUrl: body.sourceImageUrl,
        })),
      );

      return reply.code(201).send({ catalogueId, jobIds });
    },
  );

  app.get(
    '/v1/shopify/catalog/jobs',
    {
      preHandler: app.requireShopifySession,
      schema: { querystring: z.object({ catalogueId: z.string().uuid() }) },
    },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { catalogueId } = req.query as { catalogueId: string };

      const rows = await app.db
        .select({
          jobId: schema.jobs.id,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          resultKey: schema.jobOutputs.resultKey,
          shopifyMediaId: schema.shopifyCatalogJobs.shopifyMediaId,
        })
        .from(schema.jobs)
        .innerJoin(schema.shopifyCatalogJobs, eq(schema.shopifyCatalogJobs.jobId, schema.jobs.id))
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(
          and(
            eq(schema.jobs.catalogueId, catalogueId),
            eq(schema.shopifyCatalogJobs.storeId, store.id),
          ),
        );

      return {
        items: rows.map((r) => ({
          jobId: r.jobId,
          status: r.status,
          errorCode: r.errorCode,
          resultUrl: r.resultKey ? app.storage.publicUrl(r.resultKey) : null,
          published: r.shopifyMediaId != null,
        })),
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
      const accessToken = decryptToken(store.accessToken, app.env.SHOPIFY_TOKEN_ENC_KEY ?? '');
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
