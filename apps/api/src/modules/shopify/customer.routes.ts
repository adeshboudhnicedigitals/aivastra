import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  ShopifyCustomerJobRequest,
  ShopifyCustomerPhotoPreviewRequest,
  ShopifyCustomerPresignRequest,
} from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { atomicDeduct, refundAndMarkFailed } from '../credits/ledger.js';
import { mintAccountLinkCode } from './customer-auth.js';
import {
  checkShopperLimits,
  lockAndRecheckShopperLimits,
  reserveStoreDailySlot,
  ShopperLimitRaceRefusal,
} from './limits.js';
import { resolveShopper } from './shopper.js';

const SLOT_RELEASE_MAX_ATTEMPTS = 3;
const SLOT_RELEASE_RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Release a reserved store-daily-cap slot with bounded retries.
 *
 * A transient DECR failure must not permanently leak a reserved slot — the
 * 48h key expiry is the only other backstop, and that's a full day-plus of
 * lost capacity for one blip. `slot.release()` is already idempotent (see
 * `reserveStoreDailySlot`), so retrying it after a failure is always safe:
 * we're never at risk of double-releasing, only of giving up too early.
 * Exhausting retries is logged and swallowed rather than thrown — a release
 * failure must never mask the response the caller was already producing
 * (a refusal or a compensated failure).
 */
async function releaseSlotWithRetry(
  slot: { release: () => Promise<void> },
  log: FastifyBaseLogger,
  jobId?: string,
): Promise<void> {
  for (let attempt = 1; attempt <= SLOT_RELEASE_MAX_ATTEMPTS; attempt++) {
    try {
      await slot.release();
      return;
    } catch (err) {
      if (attempt === SLOT_RELEASE_MAX_ATTEMPTS) {
        log.error(
          { err, jobId, attempts: attempt },
          'shopify store daily slot release failed after retries — slot will remain reserved until the 48h key expiry',
        );
        return;
      }
      await sleep(SLOT_RELEASE_RETRY_DELAY_MS * attempt);
    }
  }
}

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
 * The workflow every Shopify try-on runs. Resolved here, at creation, and pinned
 * onto job_inputs.params so the dispatcher never has to look it up again — and so
 * an admin promoting a different default mid-flight cannot change the workflow
 * under a job whose credits are already deducted.
 *
 * Returning null means no active default is configured at all, which is a system
 * misconfiguration rather than anything the merchant did. The caller refuses the
 * job before deducting credits: enqueueing would burn a credit and produce a
 * FAILED row with NO_WORKFLOW_CONFIGURED for something no merchant can fix.
 */
async function resolveWorkflowTemplateId(app: FastifyInstance): Promise<string | null> {
  const [row] = await app.db
    .select({ workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId })
    .from(schema.shopifyFunnelTemplates)
    .where(
      and(
        eq(schema.shopifyFunnelTemplates.isDefault, true),
        eq(schema.shopifyFunnelTemplates.isActive, true),
      ),
    )
    .limit(1);
  return row?.workflowTemplateId ?? null;
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

      const {
        customerPhotoKey,
        shopifyProductId,
        clientId,
        shopifyCustomerId,
        email,
        emailConsent,
      } = req.body as {
        customerPhotoKey: string;
        shopifyProductId: number;
        clientId?: string;
        shopifyCustomerId?: number;
        email?: string;
        emailConsent?: boolean;
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
      const maxCustomerPhotoBytes = await getUploadLimitBytes(app, 'shopifyCustomerPhotoMaxBytes');
      if (photoHead.contentLength > maxCustomerPhotoBytes) {
        throw new AppError(
          'BAD_UPLOAD',
          413,
          `uploaded photo exceeds ${maxCustomerPhotoBytes / (1024 * 1024)}MB limit`,
        );
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

      const workflowTemplateId = await resolveWorkflowTemplateId(app);
      if (!workflowTemplateId) {
        // error, not warn: after the funnel removal this can only mean no active
        // default template exists, which is ours to fix, not the merchant's. The
        // shopper still sees the same soft message as a disabled product — no
        // internal state leaks to the storefront.
        app.log.error(
          { storeId, shopifyProductId, garmentId: garment.id },
          'shopify try-on blocked before enqueue: no active default funnel template is configured',
        );
        return reply
          .code(202)
          .send({ message: 'This product is not available for try-on right now.' });
      }

      // Deployed widget versions did not send clientId. They still receive the
      // store cap, while shopper-specific limits wait until an identity exists.
      let shopper: Awaited<ReturnType<typeof resolveShopper>> | null = null;
      if (clientId) {
        shopper = await resolveShopper(app, storeId, {
          clientId,
          shopifyCustomerId: shopifyCustomerId ?? null,
          email: email ?? null,
        });
        if (email && emailConsent && !shopper.emailConsent) {
          await app.db
            .update(schema.shopifyShoppers)
            .set({ emailConsent: true })
            .where(eq(schema.shopifyShoppers.id, shopper.id));
          shopper = { ...shopper, emailConsent: true };
        }

        // Fast path only — see lockAndRecheckShopperLimits for why this alone
        // does not close the per-shopper race. This just avoids reserving a
        // store slot and opening a transaction for a request that's already
        // over quota with no possibility of a concurrent winner.
        const refusal = await checkShopperLimits(app.db, store, shopper);
        if (refusal) return reply.code(202).send(refusal);
      }

      const slot = await reserveStoreDailySlot(app, store);
      if (!slot.ok) {
        return reply
          .code(202)
          .send({ reason: 'store_limit', message: "Try-on isn't available right now." });
      }

      const jobId = randomUUID();
      let jobCommitted = false;

      try {
        await app.db.transaction(async (tx) => {
          if (shopper) {
            // Serializes this shopper's requests: acquires a transaction-scoped
            // advisory lock on (store, counting identity) and rechecks the
            // limit under it, immediately before the job insert below. Throws
            // ShopperLimitRaceRefusal (caught below, rolling this transaction
            // back) if a concurrent request already consumed the slot between
            // the fast-path check above and this recheck.
            await lockAndRecheckShopperLimits(tx as never, store, shopper);
          }
          // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs. The plan explicitly notes this is the intended pattern.
          await (tx.insert(schema.jobs).values as any)({
            id: jobId,
            userId,
            shopifyStoreId: storeId,
            shopifyShopperId: shopper?.id ?? null,
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
              // Resolved above and pinned here so the dispatcher trusts it rather
              // than re-resolving — a default promoted mid-flight can't change the
              // workflow under a job whose credits are already deducted.
              workflowTemplateId,
            },
          });
          await atomicDeduct(tx as never, userId, jobCost, jobId);
        });
        jobCommitted = true;

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
      } catch (err) {
        if (err instanceof ShopperLimitRaceRefusal) {
          // Transaction already rolled back — no job, no deducted credit.
          // Only the store slot (reserved before the transaction) needs
          // releasing.
          await releaseSlotWithRetry(slot, app.log);
          return reply.code(202).send(err.refusal);
        }

        try {
          if (jobCommitted) {
            app.log.error(
              { err, jobId },
              'redis enqueue preparation failed — job will be refunded',
            );
            // One atomic, idempotent transaction: the refund, its ledger
            // entry, and the FAILED transition either all land or none do —
            // see refundAndMarkFailed for why the old two-step version could
            // leave a partially-compensated job after a crash.
            const { compensated } = await refundAndMarkFailed(
              app.db,
              userId,
              jobCost,
              jobId,
              'REFUND_ENQUEUE_FAIL',
              'ENQUEUE_FAIL',
            );
            if (!compensated) {
              // The XADD looked like it failed but actually landed: the
              // dispatcher already picked the job up and moved it past QUEUED
              // while we were in here. Not refunding is the right outcome —
              // the generation is running or done — but the shopper's client
              // still got a 503 from us for a job that will complete. Rare and
              // expected; logged so it can be correlated if a shopper reports
              // a "failed" try-on that produced an image anyway.
              app.log.warn(
                { jobId },
                'enqueue looked failed but job already left QUEUED — refund skipped to avoid double-paying a delivered generation',
              );
            }
          }
        } finally {
          await releaseSlotWithRetry(slot, app.log, jobId);
        }

        if (!jobCommitted) throw err;
        throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
      }

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
