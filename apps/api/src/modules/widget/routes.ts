import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { schema } from '@aivastra/db';
import { WidgetJobRequest, WidgetPresignRequest } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { atomicWidgetDeduct, widgetRefund } from './ledger.js';

const WIDGET_JOB_COST = 10;

function isPrivateIp(ip: string): boolean {
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    ip === '::1' ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  );
}

async function assertSafeExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('BAD_REQUEST', 400, 'Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 400, 'Only HTTPS URLs are allowed');
  }
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIp(address)) {
      throw new AppError('BAD_REQUEST', 400, 'URL resolves to a disallowed address');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('BAD_REQUEST', 400, 'Could not resolve URL hostname');
  }
}

async function checkRateLimit(
  redis: Redis,
  clientId: string,
  limit: number,
  windowSecs: number,
  reply: FastifyReply,
) {
  const key = `widget:rl:${clientId}`;
  const [[, count], [, ttl]] = (await redis.pipeline().incr(key).ttl(key).exec()) as [
    [null, number],
    [null, number],
  ];

  if (ttl === -1) await redis.expire(key, windowSecs);

  if (count > limit) {
    const remaining = ttl === -1 ? windowSecs : ttl;
    reply.header('Retry-After', Math.max(0, remaining).toString());
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

export async function widgetRoutes(app: FastifyInstance) {
  app.get('/v1/widget/config/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const [client] = await app.db
      .select({
        widgetClientId: schema.widgetClients.id,
        companyName: schema.widgetClients.companyName,
        isActive: schema.widgetClients.isActive,
      })
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.widgetKey, key))
      .limit(1);
    if (!client) {
      throw new AppError('NOT_FOUND', 404, 'Widget key not found');
    }
    return reply.send(client);
  });

  app.post(
    '/v1/widget/presign',
    {
      preHandler: [
        app.requireWidgetClient,
        async (req, reply) =>
          checkRateLimit(app.redis, req.widgetClientId as string, 60, 60, reply),
      ],
      schema: { body: WidgetPresignRequest },
    },
    async (req) => {
      const clientId = req.widgetClientId as string;
      const { contentType, contentLength } = req.body as {
        contentType: string;
        contentLength: number;
      };

      if (!contentType.startsWith('image/')) {
        throw new AppError('VALIDATION', 400, 'Content type must be image/*');
      }

      const ext = contentType.split('/')[1] ?? 'jpg';
      const key = `widget-inputs/${clientId}/${randomUUID()}/photo.${ext}`;
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`widget:upload:${key}`, clientId, 'EX', 600);

      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.post(
    '/v1/widget/jobs',
    {
      preHandler: [
        app.requireWidgetClient,
        async (req, reply) =>
          checkRateLimit(app.redis, req.widgetClientId as string, 60, 60, reply),
      ],
      schema: { body: WidgetJobRequest },
    },
    async (req, reply) => {
      const clientId = req.widgetClientId as string;

      const idempKey = req.headers['x-idempotency-key'] as string | undefined;
      const idempRedisKey = idempKey ? `idempotency:${clientId}:${idempKey}` : null;
      if (idempRedisKey) {
        const cached = await app.redis.get(idempRedisKey);
        if (cached) return reply.send({ jobId: cached });
      }

      const { garmentImageUrl, customerPhotoKey, shopifyProductId } = req.body as {
        garmentImageUrl?: string;
        customerPhotoKey: string;
        aspectRatio?: string;
        shopifyProductId?: number;
      };

      if (!customerPhotoKey.startsWith(`widget-inputs/${clientId}/`)) {
        throw new AppError('FORBIDDEN', 403, 'customer photo key does not belong to this client');
      }

      const uploadOwner = await app.redis.get(`widget:upload:${customerPhotoKey}`);
      if (uploadOwner !== clientId) {
        throw new AppError('FORBIDDEN', 403, 'upload session expired or not owned');
      }

      let photoHead: { contentLength: number };
      try {
        photoHead = await app.storage.headObject(customerPhotoKey);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded photo not found');
      }
      if (photoHead.contentLength > 5 * 1024 * 1024) {
        throw new AppError('BAD_UPLOAD', 413, 'uploaded photo exceeds 5MB limit');
      }

      let resolvedGarmentKey: string | null = null;
      let jobParams: Record<string, unknown> = {};
      let jobCost = WIDGET_JOB_COST;

      if (shopifyProductId) {
        const [store] = await app.db
          .select()
          .from(schema.shopifyStores)
          .where(eq(schema.shopifyStores.widgetClientId, clientId))
          .limit(1);
        if (!store || store.uninstalledAt) {
          throw new AppError('FORBIDDEN', 403, 'store not active');
        }

        const [garment] = await app.db
          .select()
          .from(schema.shopifyProductGarments)
          .where(
            and(
              eq(schema.shopifyProductGarments.storeId, store.id),
              eq(schema.shopifyProductGarments.shopifyProductId, shopifyProductId),
              eq(schema.shopifyProductGarments.status, 'active'),
            ),
          )
          .limit(1);

        if (!garment) {
          // trigger async sync, tell the storefront to retry
          const { enqueueSync } = await import('../shopify/service.js');
          await enqueueSync(app.redis, { storeId: store.id, mode: 'product', shopifyProductId });
          return reply
            .code(202)
            .send({ message: "We're preparing this product for try-on. Check back in a moment." });
        }

        resolvedGarmentKey = garment.r2Key;
        jobCost = app.env.SHOPIFY_JOB_COST;
        jobParams = {
          kind: 'shopify',
          shopifyProductId,
          workflowTemplateId: store.settings?.workflowTemplateId,
        };
      }

      let garmentR2Key: string;
      if (resolvedGarmentKey) {
        garmentR2Key = resolvedGarmentKey;
      } else {
        if (!garmentImageUrl) {
          throw new AppError('VALIDATION', 400, 'garmentImageUrl is required');
        }
        await assertSafeExternalUrl(garmentImageUrl);

        let garmentBuffer: Buffer;
        let garmentContentType: string;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const res = await fetch(garmentImageUrl, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ct = res.headers.get('content-type') ?? 'image/jpeg';
          const cl = res.headers.get('content-length');
          if (cl && parseInt(cl, 10) > 10 * 1024 * 1024) {
            throw new Error('Garment image exceeds 10MB');
          }
          const arrayBuffer = await res.arrayBuffer();
          if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
            throw new Error('Garment image exceeds 10MB');
          }
          garmentBuffer = Buffer.from(arrayBuffer);
          garmentContentType = ct;
        } catch (err: unknown) {
          req.log.warn({ err, garmentImageUrl }, 'garment image download failed');
          throw new AppError('BAD_REQUEST', 400, 'Failed to download garment image');
        }

        const garmentExt = garmentContentType.split('/')[1] ?? 'jpg';
        garmentR2Key = `widget-garments/${clientId}/${randomUUID()}/garment.${garmentExt}`;
        await app.storage.putObject(garmentR2Key, garmentBuffer, garmentContentType);
      }

      const jobId = randomUUID();
      await app.db.transaction(async (tx) => {
        // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId/FK cols as non-null; widget jobs legitimately have null userId and null face/bg/pose
        await (tx.insert(schema.jobs).values as any)({
          id: jobId,
          userId: null,
          widgetClientId: clientId,
          customerPhotoKey,
          status: 'QUEUED',
          creditsCharged: jobCost,
        });

        // biome-ignore lint/suspicious/noExplicitAny: same — face/bg/pose are nullable in SQL but Drizzle types them non-null
        await (tx.insert(schema.jobInputs).values as any)({
          jobId,
          upperGarmentKey: garmentR2Key,
          faceId: null,
          backgroundId: null,
          poseId: null,
          params: jobParams,
        });

        // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the widget ledger helper
        await atomicWidgetDeduct(tx as any, clientId, jobCost, jobId);
      });

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

      if (idempRedisKey) {
        await app.redis.set(idempRedisKey, jobId, 'EX', 600);
      }

      return reply.code(201).send({ jobId });
    },
  );

  app.get('/v1/widget/jobs/:id', { preHandler: app.requireWidgetClient }, async (req, reply) => {
    const clientId = req.widgetClientId as string;
    const { id } = req.params as { id: string };

    const [job] = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        widgetClientId: schema.jobs.widgetClientId,
        resultKey: schema.jobOutputs.resultKey,
        errorCode: schema.jobs.errorCode,
        createdAt: schema.jobs.createdAt,
        completedAt: schema.jobs.completedAt,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobOutputs, eq(schema.jobs.id, schema.jobOutputs.jobId))
      .where(eq(schema.jobs.id, id))
      .limit(1);

    if (!job || job.widgetClientId !== clientId) {
      throw new AppError('NOT_FOUND', 404, 'Job not found');
    }

    return reply.send(job);
  });

  app.delete('/v1/widget/jobs/:id', { preHandler: app.requireWidgetClient }, async (req, reply) => {
    const clientId = req.widgetClientId as string;
    const { id } = req.params as { id: string };

    const [job] = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        widgetClientId: schema.jobs.widgetClientId,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
      .limit(1);

    if (!job || job.widgetClientId !== clientId) {
      throw new AppError('NOT_FOUND', 404, 'Job not found');
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new AppError('NOT_CANCELLABLE', 409, 'Job is already finished or cancelled');
    }

    if (job.status === 'GENERATING' || job.status === 'UPLOADING') {
      throw new AppError('NOT_CANCELLABLE', 409, 'Job is already being processed');
    }

    // Status is QUEUED or PREPROCESSING
    await app.db.transaction(async (tx) => {
      await tx.update(schema.jobs).set({ status: 'CANCELLED' }).where(eq(schema.jobs.id, id));
      // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses custom methods in the widget ledger helper
      await widgetRefund(tx as any, clientId, WIDGET_JOB_COST, id, 'REFUND_CANCELLED');
    });

    const evt = JSON.stringify({ type: 'STATUS', jobId: id, status: 'CANCELLED' });
    await app.redis.publish(`sse:events:widget:${clientId}`, evt);

    return reply.send({ status: 'CANCELLED' });
  });

  app.get(
    '/v1/widget/jobs/:id/events',
    { preHandler: app.requireWidgetClient },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const clientId = req.widgetClientId as string;

      const [job] = await app.db
        .select({ id: schema.jobs.id, widgetClientId: schema.jobs.widgetClientId })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id))
        .limit(1);

      if (!job || job.widgetClientId !== clientId) {
        throw new AppError('NOT_FOUND', 404, 'Job not found');
      }

      writeSseHeaders(reply);

      // biome-ignore lint/suspicious/noExplicitAny: redisSub is decorated on app at runtime; not in Fastify's type map
      const sub: Redis = (app as any).redisSub.duplicate();
      const channel = `sse:events:widget:${clientId}`;

      // ioredis throws an uncaught exception (crashing the process) if a connection
      // emits 'error' with no listener attached — must register one even if a no-op.
      sub.on('error', (err) => {
        req.log.warn({ err, channel }, 'sse redis subscriber error');
      });

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

      const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 15_000);

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
