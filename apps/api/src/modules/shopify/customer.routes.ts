import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  ShopifyCustomerJobRequest,
  ShopifyCustomerPhotoPreviewRequest,
  ShopifyCustomerPresignRequest,
} from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct } from '../credits/ledger.js';
import { mintAccountLinkCode } from './customer-auth.js';

// biome-ignore lint/suspicious/noExplicitAny: lazy import avoids circular dependency with service.js
let _enqueueSync: ((...args: any[]) => Promise<void>) | null = null;
async function getEnqueueSync() {
  if (!_enqueueSync) {
    const mod = await import('./service.js');
    _enqueueSync = mod.enqueueSync;
  }
  if (!_enqueueSync) throw new AppError('INTERNAL', 500, 'Failed to load sync module');
  return _enqueueSync;
}

async function checkRateLimit(redis: Redis, storeId: string, reply: FastifyReply) {
  const key = `shopify:customer:rl:${storeId}`;
  const [[, count], [, ttl]] = (await redis.pipeline().incr(key).ttl(key).exec()) as [
    [null, number],
    [null, number],
  ];
  if (ttl === -1) await redis.expire(key, 60);
  if (count > 60) {
    reply.header('Retry-After', Math.max(0, ttl === -1 ? 60 : ttl).toString());
    throw new AppError('RATE_LIMITED', 429, 'rate limit exceeded');
  }
}

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

/**
 * Resolves which aivastra account bills this store's try-on jobs and confirms
 * that account can afford one. Throws INSUFFICIENT_CREDITS (402) for both an
 * unlinked store and a merchant who's actually out of credits — the widget
 * shows the same generic message either way.
 */
async function requireStoreOwnerWithCredits(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  jobCost: number,
): Promise<string> {
  if (!store.ownerUserId) {
    throw new AppError('INSUFFICIENT_CREDITS', 402, 'Store is not linked to a billing account');
  }
  const [credits] = await app.db
    .select({ balance: schema.userCredits.balance })
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, store.ownerUserId));
  if (!credits || credits.balance < jobCost) {
    throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
  }
  return store.ownerUserId;
}

/**
 * Checks whether an R2 key belongs to this store and is still an active upload.
 * Returns true if both checks pass, false otherwise.
 */
async function isCustomerPhotoOwnedByStore(
  app: FastifyInstance,
  storeId: string,
  r2Key: string,
): Promise<boolean> {
  if (!r2Key.startsWith(`shopify-inputs/${storeId}/`)) return false;
  const owner = await app.redis.get(`shopify:upload:${r2Key}`);
  return owner === storeId;
}

export async function shopifyCustomerRoutes(app: FastifyInstance) {
  app.post('/v1/shopify/customer/account/link', { preHandler: app.requireUser }, async (req) => {
    const code = await mintAccountLinkCode(app.redis, req.userId);
    return { code };
  });

  app.post(
    '/v1/shopify/customer/presign',
    {
      preHandler: [
        app.requireShopifyStoreKey,
        async (req, reply) => checkRateLimit(app.redis, req.shopifyStoreId as string, reply),
      ],
      schema: { body: ShopifyCustomerPresignRequest },
    },
    async (req) => {
      const storeId = req.shopifyStoreId as string;
      const { contentType, contentLength } = req.body as ShopifyCustomerPresignRequest;
      if (!contentType.startsWith('image/')) {
        throw new AppError('VALIDATION', 400, 'Content type must be image/*');
      }
      // No image extension on the key — Cloudflare's Hotlink Protection pattern-matches
      // image extensions in the path regardless of method and false-positives this
      // presigned PUT/OPTIONS as an image hotlink. Content-Type is passed separately
      // to presignPut and stored as the object's actual Content-Type header.
      const key = `shopify-inputs/${storeId}/${randomUUID()}/photo`;
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`shopify:upload:${key}`, storeId, 'EX', 600);
      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.post(
    '/v1/shopify/customer/photo/preview',
    {
      preHandler: [
        app.requireShopifyStoreKey,
        async (req, reply) => checkRateLimit(app.redis, req.shopifyStoreId as string, reply),
      ],
      schema: { body: ShopifyCustomerPhotoPreviewRequest },
    },
    async (req) => {
      const storeId = req.shopifyStoreId as string;
      const { r2Key } = req.body as ShopifyCustomerPhotoPreviewRequest;

      if (!(await isCustomerPhotoOwnedByStore(app, storeId, r2Key))) {
        throw new AppError('NOT_FOUND', 404, 'photo not available');
      }

      const { url, expiresIn } = await app.storage.presignGet(r2Key, 300);
      return { previewUrl: url, expiresIn };
    },
  );

  app.post(
    '/v1/shopify/customer/jobs',
    {
      preHandler: [
        app.requireShopifyStoreKey,
        async (req, reply) => checkRateLimit(app.redis, req.shopifyStoreId as string, reply),
      ],
      schema: { body: ShopifyCustomerJobRequest },
    },
    async (req, reply) => {
      const storeId = req.shopifyStoreId as string;
      const store = req.shopifyStoreRow as typeof schema.shopifyStores.$inferSelect;

      const jobCost = await getTryonCreditCost(app);
      const userId = await requireStoreOwnerWithCredits(app, store, jobCost);

      const { customerPhotoKey, shopifyProductId } = req.body as {
        customerPhotoKey: string;
        shopifyProductId: number;
      };

      if (!(await isCustomerPhotoOwnedByStore(app, storeId, customerPhotoKey))) {
        throw new AppError('FORBIDDEN', 403, 'upload session expired or not owned');
      }

      let photoHead: { contentLength: number };
      try {
        photoHead = await app.storage.headObject(customerPhotoKey);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded photo not found');
      }
      if (photoHead.contentLength > 20 * 1024 * 1024) {
        throw new AppError('BAD_UPLOAD', 413, 'uploaded photo exceeds 20MB limit');
      }

      const [garment] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, shopifyProductId),
            eq(schema.shopifyProductGarments.status, 'active'),
          ),
        )
        .limit(1);

      if (!garment) {
        const enq = await getEnqueueSync();
        await enq(app.redis, { storeId, mode: 'product', shopifyProductId });
        return reply
          .code(202)
          .send({ message: "We're preparing this product for try-on. Check back in a moment." });
      }
      if (!garment.enabled) {
        return reply
          .code(202)
          .send({ message: 'This product is not available for try-on right now.' });
      }

      const jobId = randomUUID();

      await app.db.transaction(async (tx) => {
        // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs. The plan explicitly notes this is the intended pattern.
        await (tx.insert(schema.jobs).values as any)({
          id: jobId,
          userId,
          shopifyStoreId: storeId,
          customerPhotoKey,
          status: 'QUEUED',
          creditsCharged: jobCost,
          source: 'shopify',
        });
        // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs. The plan explicitly notes this is the intended pattern.
        await (tx.insert(schema.jobInputs).values as any)({
          jobId,
          upperGarmentKey: garment.r2Key,
          faceId: null,
          backgroundId: null,
          poseId: null,
          params: {
            kind: 'shopify',
            shopifyProductId,
            workflowTemplateId: store.settings?.workflowTemplateId,
          },
        });
        await atomicDeduct(tx as never, userId, jobCost, jobId);
      });

      // Extends the presign-time ownership marker (originally EX 600, matching the
      // presigned URL's own expiry) to 24h now that the photo has proven itself real
      // and usable — this is what lets a returning shopper reuse it for a different
      // product without re-uploading. Idempotent: re-extends on every reuse too.
      await app.redis.set(`shopify:upload:${customerPhotoKey}`, storeId, 'EX', 86400);

      await app.redis.xadd(
        'jobs:normal',
        'MAXLEN',
        '~',
        10000,
        '*',
        'jobId',
        jobId,
        'type',
        'WIDGET_TRYON',
      );

      return reply.code(201).send({ jobId });
    },
  );

  app.get(
    '/v1/shopify/customer/jobs/:id',
    { preHandler: app.requireShopifyStoreKey },
    async (req) => {
      const storeId = req.shopifyStoreId as string;
      const { id } = req.params as { id: string };

      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          shopifyStoreId: schema.jobs.shopifyStoreId,
          resultKey: schema.jobOutputs.resultKey,
          errorCode: schema.jobs.errorCode,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobs.id, schema.jobOutputs.jobId))
        .where(eq(schema.jobs.id, id))
        .limit(1);

      if (!job || job.shopifyStoreId !== storeId) {
        throw new AppError('NOT_FOUND', 404, 'Job not found');
      }
      return {
        id: job.id,
        status: job.status,
        errorCode: job.errorCode,
        resultUrl: job.resultKey ? app.storage.publicUrl(job.resultKey) : null,
      };
    },
  );

  app.get(
    '/v1/shopify/customer/jobs/:id/events',
    { preHandler: app.requireShopifyStoreKey },
    async (req, reply) => {
      const storeId = req.shopifyStoreId as string;
      const store = req.shopifyStoreRow as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };

      const [job] = await app.db
        .select({ id: schema.jobs.id, shopifyStoreId: schema.jobs.shopifyStoreId })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id))
        .limit(1);
      if (!job || job.shopifyStoreId !== storeId) {
        throw new AppError('NOT_FOUND', 404, 'Job not found');
      }
      if (!store.ownerUserId) {
        throw new AppError('NOT_FOUND', 404, 'Job not found');
      }

      writeSseHeaders(reply);
      const sub: Redis = app.redisSub.duplicate();
      const channel = `sse:events:${store.ownerUserId}`;
      sub.on('error', (err) => req.log.warn({ err, channel }, 'sse subscriber error'));
      await sub.subscribe(channel);
      sub.on('message', (_ch, raw) => {
        try {
          const evt = JSON.parse(raw) as Record<string, unknown>;
          if (evt.jobId !== id) return;
          reply.raw.write(`event: ${evt.type ?? 'message'}\ndata: ${raw}\n\n`);
        } catch {
          /* ignore malformed publish */
        }
      });
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
      req.raw.on('close', async () => {
        clearInterval(heartbeat);
        try {
          await sub.unsubscribe(channel);
        } catch {
          /* connection may already be closed */
        }
        sub.disconnect();
      });
    },
  );
}
