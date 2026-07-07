import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { KioskJobCreateBody, KioskPresignBody } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createWidgetStyleJob, WIDGET_JOB_COST } from '../widget/create-job.js';
import { widgetRefund } from '../widget/ledger.js';

const MAX_KIOSK_UPLOAD_BYTES = 5 * 1024 * 1024;

async function checkRateLimit(
  redis: Redis,
  deviceId: string,
  limit: number,
  windowSecs: number,
  reply: FastifyReply,
) {
  const key = `kiosk:job:rl:${deviceId}`;
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

async function loadOwnedJob(app: FastifyInstance, widgetClientId: string, id: string) {
  const [job] = await app.db
    .select({
      id: schema.jobs.id,
      status: schema.jobs.status,
      widgetClientId: schema.jobs.widgetClientId,
      kioskDeviceId: schema.jobs.kioskDeviceId,
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

  if (!job || job.widgetClientId !== widgetClientId) {
    throw new AppError('NOT_FOUND', 404, 'job not found');
  }

  return job;
}

async function serializeJob(app: FastifyInstance, widgetClientId: string, id: string) {
  const job = await loadOwnedJob(app, widgetClientId, id);
  const [liked, inCart] = await Promise.all([
    app.db
      .select({ id: schema.kioskResultLikes.id })
      .from(schema.kioskResultLikes)
      .where(
        and(
          eq(schema.kioskResultLikes.jobId, id),
          eq(schema.kioskResultLikes.widgetClientId, widgetClientId),
        ),
      )
      .limit(1),
    app.db
      .select({ id: schema.kioskResultCartItems.id })
      .from(schema.kioskResultCartItems)
      .where(
        and(
          eq(schema.kioskResultCartItems.jobId, id),
          eq(schema.kioskResultCartItems.widgetClientId, widgetClientId),
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
    widgetClientId: job.widgetClientId,
    kioskDeviceId: job.kioskDeviceId,
    resultKey: job.resultKey,
    shareUrl,
    errorCode: job.errorCode,
    liked: liked.length > 0,
    inCart: inCart.length > 0,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function kioskJobsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/kiosk/presign',
    { preHandler: app.requireKioskDevice, schema: { body: KioskPresignBody } },
    async (req) => {
      const kioskDeviceId = req.kioskDeviceId;
      if (!kioskDeviceId) throw new AppError('UNAUTH', 401, 'missing kiosk device');

      const { contentType, contentLength } = req.body as z.infer<typeof KioskPresignBody>;
      const ext = contentType.split('/')[1] ?? 'jpg';
      const key = `kiosk-inputs/${kioskDeviceId}/${randomUUID()}/photo.${ext}`;
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, kioskDeviceId, 'EX', 600);

      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.post(
    '/v1/kiosk/jobs',
    {
      preHandler: [
        app.requireKioskDevice,
        async (req, reply) => checkRateLimit(app.redis, req.kioskDeviceId as string, 60, 60, reply),
      ],
      schema: { body: KioskJobCreateBody },
    },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      const kioskDeviceId = req.kioskDeviceId;
      if (!widgetClientId || !kioskDeviceId) {
        throw new AppError('UNAUTH', 401, 'missing kiosk identity');
      }

      const { merchantCatalogItemId, customerPhotoKey } = req.body as z.infer<
        typeof KioskJobCreateBody
      >;
      const [item] = await app.db
        .select({
          id: schema.merchantCatalogItems.id,
          widgetClientId: schema.merchantCatalogItems.widgetClientId,
          r2Key: schema.merchantCatalogItems.r2Key,
          isActive: schema.merchantCatalogItems.isActive,
          moderationStatus: schema.merchantCatalogItems.moderationStatus,
        })
        .from(schema.merchantCatalogItems)
        .where(eq(schema.merchantCatalogItems.id, merchantCatalogItemId))
        .limit(1);

      if (!item || item.widgetClientId !== widgetClientId) {
        throw new AppError('NOT_FOUND', 404, 'catalog item not found');
      }
      if (!item.isActive || item.moderationStatus !== 'approved') {
        throw new AppError('FORBIDDEN', 403, 'catalog item is not available');
      }
      if (!customerPhotoKey.startsWith(`kiosk-inputs/${kioskDeviceId}/`)) {
        throw new AppError('FORBIDDEN', 403, 'customer photo key does not belong to this device');
      }

      const uploadOwner = await app.redis.get(`upload:owner:${customerPhotoKey}`);
      if (uploadOwner !== kioskDeviceId) {
        throw new AppError('FORBIDDEN', 403, 'upload session expired or not owned');
      }

      let photoHead: { contentLength: number };
      try {
        photoHead = await app.storage.headObject(customerPhotoKey);
      } catch {
        throw new AppError('BAD_UPLOAD', 400, 'uploaded photo not found');
      }
      if (photoHead.contentLength > MAX_KIOSK_UPLOAD_BYTES) {
        throw new AppError('BAD_UPLOAD', 413, 'uploaded photo exceeds 5MB limit');
      }

      const jobId = await createWidgetStyleJob(app, {
        widgetClientId,
        kioskDeviceId,
        upperGarmentKey: item.r2Key,
        customerPhotoKey,
        cost: WIDGET_JOB_COST,
      });

      reply.code(201);
      return { jobId };
    },
  );

  app.get(
    '/v1/kiosk/jobs/:id',
    {
      preHandler: app.requireKioskDevice,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      return serializeJob(app, widgetClientId, id);
    },
  );

  app.delete(
    '/v1/kiosk/jobs/:id',
    {
      preHandler: app.requireKioskDevice,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      const job = await loadOwnedJob(app, widgetClientId, id);

      if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        throw new AppError('NOT_CANCELLABLE', 409, 'Job is already finished or cancelled');
      }
      if (job.status === 'GENERATING' || job.status === 'UPLOADING') {
        throw new AppError('NOT_CANCELLABLE', 409, 'Job is already being processed');
      }

      await app.db.transaction(async (tx) => {
        await tx.update(schema.jobs).set({ status: 'CANCELLED' }).where(eq(schema.jobs.id, id));
        // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses custom methods in the widget ledger helper.
        await widgetRefund(tx as any, widgetClientId, job.creditsCharged, id, 'REFUND_CANCELLED');
      });

      const evt = JSON.stringify({ type: 'STATUS', jobId: id, status: 'CANCELLED' });
      await app.redis.publish(`sse:events:widget:${widgetClientId}`, evt);

      reply.code(200);
      return { status: 'CANCELLED' };
    },
  );

  app.get(
    '/v1/kiosk/jobs/:id/events',
    {
      preHandler: app.requireKioskDevice,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };

      await loadOwnedJob(app, widgetClientId, id);
      writeSseHeaders(reply);

      // biome-ignore lint/suspicious/noExplicitAny: redisSub is decorated on app at runtime; not in Fastify's type map.
      const sub: Redis = (app as any).redisSub.duplicate();
      const channel = `sse:events:widget:${widgetClientId}`;

      sub.on('error', (err) => {
        req.log.warn({ err, channel }, 'kiosk sse redis subscriber error');
      });

      await sub.subscribe(channel);
      sub.on('message', (_channel, raw) => {
        try {
          const evt = JSON.parse(raw) as Record<string, unknown>;
          if (evt.jobId !== id) return;
          reply.raw.write(`event: ${evt.type ?? 'message'}\ndata: ${raw}\n\n`);
        } catch {
          // ignore malformed publish
        }
      });

      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

      req.raw.on('close', async () => {
        clearInterval(heartbeat);
        try {
          await sub.unsubscribe(channel);
        } catch {
          // connection may already be closed
        }
        sub.disconnect();
      });
    },
  );
}
