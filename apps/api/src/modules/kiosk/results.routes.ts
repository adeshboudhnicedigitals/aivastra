import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

async function assertOwnedJob(app: FastifyInstance, widgetClientId: string, jobId: string) {
  const [job] = await app.db
    .select({ id: schema.jobs.id, widgetClientId: schema.jobs.widgetClientId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job || job.widgetClientId !== widgetClientId) {
    throw new AppError('NOT_FOUND', 404, 'job not found');
  }
}

export async function kioskResultsRoutes(app: FastifyInstance) {
  const paramsSchema = z.object({ jobId: z.string().uuid() });
  const noBodySchema = z.union([z.undefined(), z.null()]);

  app.put(
    '/v1/kiosk/results/:jobId/like',
    { preHandler: app.requireKioskDevice, schema: { params: paramsSchema, body: noBodySchema } },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      const kioskDeviceId = req.kioskDeviceId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { jobId } = req.params as { jobId: string };
      await assertOwnedJob(app, widgetClientId, jobId);

      await app.db
        .insert(schema.kioskResultLikes)
        .values({ jobId, widgetClientId, kioskDeviceId: kioskDeviceId ?? null })
        .onConflictDoNothing();

      reply.code(204);
      return reply.send();
    },
  );

  app.delete(
    '/v1/kiosk/results/:jobId/like',
    { preHandler: app.requireKioskDevice, schema: { params: paramsSchema, body: noBodySchema } },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { jobId } = req.params as { jobId: string };
      await assertOwnedJob(app, widgetClientId, jobId);

      await app.db
        .delete(schema.kioskResultLikes)
        .where(
          and(
            eq(schema.kioskResultLikes.jobId, jobId),
            eq(schema.kioskResultLikes.widgetClientId, widgetClientId),
          ),
        );

      reply.code(204);
      return reply.send();
    },
  );

  app.put(
    '/v1/kiosk/results/:jobId/cart',
    { preHandler: app.requireKioskDevice, schema: { params: paramsSchema, body: noBodySchema } },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      const kioskDeviceId = req.kioskDeviceId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { jobId } = req.params as { jobId: string };
      await assertOwnedJob(app, widgetClientId, jobId);

      await app.db
        .insert(schema.kioskResultCartItems)
        .values({ jobId, widgetClientId, kioskDeviceId: kioskDeviceId ?? null })
        .onConflictDoNothing();

      reply.code(204);
      return reply.send();
    },
  );

  app.delete(
    '/v1/kiosk/results/:jobId/cart',
    { preHandler: app.requireKioskDevice, schema: { params: paramsSchema, body: noBodySchema } },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { jobId } = req.params as { jobId: string };
      await assertOwnedJob(app, widgetClientId, jobId);

      await app.db
        .delete(schema.kioskResultCartItems)
        .where(
          and(
            eq(schema.kioskResultCartItems.jobId, jobId),
            eq(schema.kioskResultCartItems.widgetClientId, widgetClientId),
          ),
        );

      reply.code(204);
      return reply.send();
    },
  );
}
