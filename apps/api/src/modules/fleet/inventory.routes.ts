import { schema } from '@aivastra/db';
import {
  fleetGpuUpsertSchema,
  fleetHostReviewCreateSchema,
  fleetHostUpsertSchema,
  fleetInventoryDeleteSchema,
  fleetInventoryIdSchema,
  fleetInventorySchema,
  fleetWorkerMapSchema,
} from '@aivastra/types';
import { asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import {
  changedFields,
  gpuDeleteError,
  hostDeleteError,
  mappingError,
  moneyIn,
  moneyOut,
} from './inventory-core.js';

const idParams = z.object({ id: fleetInventoryIdSchema });
const workerParams = z.object({ id: z.string().min(1).max(100) });

/** Operator-maintained inventory: hosts, GPUs, which worker runs where, and review notes. */
export async function fleetInventoryRoutes(app: FastifyInstance) {
  async function load() {
    const hosts = await app.db.select().from(schema.fleetHosts).orderBy(asc(schema.fleetHosts.id));
    const gpus = await app.db.select().from(schema.fleetGpus).orderBy(asc(schema.fleetGpus.id));
    const workers = await app.db
      .select({
        workerId: schema.workers.id,
        label: schema.workers.label,
        hostId: schema.fleetWorkerMap.hostId,
        gpuId: schema.fleetWorkerMap.gpuId,
      })
      .from(schema.workers)
      .leftJoin(schema.fleetWorkerMap, eq(schema.fleetWorkerMap.workerId, schema.workers.id))
      .orderBy(asc(schema.workers.id));
    const reviews = await app.db
      .selectDistinctOn([schema.fleetHostReviews.hostId], {
        hostId: schema.fleetHostReviews.hostId,
        note: schema.fleetHostReviews.note,
        reviewedAt: schema.fleetHostReviews.reviewedAt,
        reviewedBy: schema.users.email,
      })
      .from(schema.fleetHostReviews)
      .leftJoin(schema.users, eq(schema.users.id, schema.fleetHostReviews.reviewedBy))
      .orderBy(schema.fleetHostReviews.hostId, desc(schema.fleetHostReviews.reviewedAt));
    const review = new Map(reviews.map((r) => [r.hostId, r]));
    return fleetInventorySchema.parse({
      generatedAt: new Date().toISOString(),
      hosts: hosts.map((h) => {
        const r = review.get(h.id);
        return {
          id: h.id,
          label: h.label,
          provider: h.provider,
          rented: h.rented,
          monthlyCostUsd: moneyOut(h.monthlyCostUsd),
          inventoryVerified: h.inventoryVerified,
          updatedAt: h.updatedAt.toISOString(),
          latestReview: r
            ? { note: r.note, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt.toISOString() }
            : null,
        };
      }),
      gpus: gpus.map((g) => ({
        id: g.id,
        hostId: g.hostId,
        model: g.model,
        vramTotalMb: g.vramTotalMb,
        updatedAt: g.updatedAt.toISOString(),
      })),
      workers: workers.map((w) => ({
        workerId: w.workerId,
        label: w.label,
        hostId: w.hostId ?? null,
        gpuId: w.gpuId ?? null,
      })),
    });
  }

  const actor = (req: { userId: string; adminRole?: unknown }) => ({
    userId: req.userId,
    role: req.adminRole as string,
  });

  app.get('/admin/fleet/inventory', { preHandler: requirePermission('fleet.view') }, load);

  app.put(
    '/admin/fleet/inventory/hosts/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: idParams, body: fleetHostUpsertSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { reason, ...b } = req.body as z.infer<typeof fleetHostUpsertSchema>;
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.fleetHosts)
          .where(eq(schema.fleetHosts.id, id));
        const values = {
          label: b.label,
          provider: b.provider,
          rented: b.rented,
          monthlyCostUsd: moneyIn(b.monthlyCostUsd),
          inventoryVerified: b.inventoryVerified,
          updatedBy: req.userId,
        };
        await tx
          .insert(schema.fleetHosts)
          .values({ id, ...values })
          .onConflictDoUpdate({
            target: schema.fleetHosts.id,
            set: { ...values, updatedAt: new Date() },
          });
        const { before: bf, after: af } = changedFields(
          before
            ? {
                label: before.label,
                provider: before.provider,
                rented: before.rented,
                monthlyCostUsd: before.monthlyCostUsd,
                inventoryVerified: before.inventoryVerified,
              }
            : null,
          {
            label: values.label,
            provider: values.provider,
            rented: values.rented,
            monthlyCostUsd: values.monthlyCostUsd,
            inventoryVerified: values.inventoryVerified,
          },
        );
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.host.upsert',
          resourceType: 'fleet_host',
          resourceId: id,
          before: bf,
          after: { ...af, reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.delete(
    '/admin/fleet/inventory/hosts/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: idParams, body: fleetInventoryDeleteSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { reason } = req.body as z.infer<typeof fleetInventoryDeleteSchema>;
      await app.db.transaction(async (tx) => {
        const [host] = await tx
          .select()
          .from(schema.fleetHosts)
          .where(eq(schema.fleetHosts.id, id));
        if (!host) throw new AppError('NOT_FOUND', 404, 'Host not found');
        const [g] = await tx
          .select({ n: count() })
          .from(schema.fleetGpus)
          .where(eq(schema.fleetGpus.hostId, id));
        const [w] = await tx
          .select({ n: count() })
          .from(schema.fleetWorkerMap)
          .where(eq(schema.fleetWorkerMap.hostId, id));
        const [r] = await tx
          .select({ n: count() })
          .from(schema.fleetHostReviews)
          .where(eq(schema.fleetHostReviews.hostId, id));
        const blocked = hostDeleteError({
          gpus: g?.n ?? 0,
          workers: w?.n ?? 0,
          reviews: r?.n ?? 0,
        });
        if (blocked) throw new AppError('HOST_IN_USE', 409, blocked);
        await tx.delete(schema.fleetHosts).where(eq(schema.fleetHosts.id, id));
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.host.delete',
          resourceType: 'fleet_host',
          resourceId: id,
          before: { label: host.label },
          after: { reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.put(
    '/admin/fleet/inventory/gpus/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: idParams, body: fleetGpuUpsertSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { reason, ...b } = req.body as z.infer<typeof fleetGpuUpsertSchema>;
      await app.db.transaction(async (tx) => {
        const [host] = await tx
          .select({ id: schema.fleetHosts.id })
          .from(schema.fleetHosts)
          .where(eq(schema.fleetHosts.id, b.hostId));
        if (!host) throw new AppError('NOT_FOUND', 404, `Host ${b.hostId} does not exist`);
        const [before] = await tx
          .select()
          .from(schema.fleetGpus)
          .where(eq(schema.fleetGpus.id, id));
        if (before && before.hostId !== b.hostId) {
          const [w] = await tx
            .select({ n: count() })
            .from(schema.fleetWorkerMap)
            .where(eq(schema.fleetWorkerMap.gpuId, id));
          if ((w?.n ?? 0) > 0)
            throw new AppError(
              'GPU_IN_USE',
              409,
              'This GPU has mapped workers; unmap them before moving it to another host.',
            );
        }
        const values = {
          hostId: b.hostId,
          model: b.model,
          vramTotalMb: b.vramTotalMb,
          updatedBy: req.userId,
        };
        await tx
          .insert(schema.fleetGpus)
          .values({ id, ...values })
          .onConflictDoUpdate({
            target: schema.fleetGpus.id,
            set: { ...values, updatedAt: new Date() },
          });
        const { before: bf, after: af } = changedFields(
          before
            ? { hostId: before.hostId, model: before.model, vramTotalMb: before.vramTotalMb }
            : null,
          { hostId: values.hostId, model: values.model, vramTotalMb: values.vramTotalMb },
        );
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.gpu.upsert',
          resourceType: 'fleet_gpu',
          resourceId: id,
          before: bf,
          after: { ...af, reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.delete(
    '/admin/fleet/inventory/gpus/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: idParams, body: fleetInventoryDeleteSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { reason } = req.body as z.infer<typeof fleetInventoryDeleteSchema>;
      await app.db.transaction(async (tx) => {
        const [gpu] = await tx.select().from(schema.fleetGpus).where(eq(schema.fleetGpus.id, id));
        if (!gpu) throw new AppError('NOT_FOUND', 404, 'GPU not found');
        const [w] = await tx
          .select({ n: count() })
          .from(schema.fleetWorkerMap)
          .where(eq(schema.fleetWorkerMap.gpuId, id));
        const blocked = gpuDeleteError(w?.n ?? 0);
        if (blocked) throw new AppError('GPU_IN_USE', 409, blocked);
        await tx.delete(schema.fleetGpus).where(eq(schema.fleetGpus.id, id));
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.gpu.delete',
          resourceType: 'fleet_gpu',
          resourceId: id,
          before: { hostId: gpu.hostId, model: gpu.model },
          after: { reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.put(
    '/admin/fleet/inventory/workers/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: workerParams, body: fleetWorkerMapSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const { reason, hostId, gpuId } = req.body as z.infer<typeof fleetWorkerMapSchema>;
      await app.db.transaction(async (tx) => {
        const [worker] = await tx
          .select({ id: schema.workers.id })
          .from(schema.workers)
          .where(eq(schema.workers.id, id));
        if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');
        const [before] = await tx
          .select()
          .from(schema.fleetWorkerMap)
          .where(eq(schema.fleetWorkerMap.workerId, id));
        if (hostId === null || gpuId === null) {
          await tx.delete(schema.fleetWorkerMap).where(eq(schema.fleetWorkerMap.workerId, id));
        } else {
          const [gpu] = await tx
            .select({ id: schema.fleetGpus.id, hostId: schema.fleetGpus.hostId })
            .from(schema.fleetGpus)
            .where(eq(schema.fleetGpus.id, gpuId));
          const bad = mappingError(hostId, gpuId, gpu);
          if (bad) throw new AppError('BAD_MAPPING', 409, bad);
          await tx
            .insert(schema.fleetWorkerMap)
            .values({ workerId: id, hostId, gpuId, updatedBy: req.userId })
            .onConflictDoUpdate({
              target: schema.fleetWorkerMap.workerId,
              set: { hostId, gpuId, updatedBy: req.userId, updatedAt: new Date() },
            });
        }
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.worker.map',
          resourceType: 'worker',
          resourceId: id,
          before: before
            ? { hostId: before.hostId, gpuId: before.gpuId }
            : { hostId: null, gpuId: null },
          after: { hostId, gpuId, reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.post(
    '/admin/fleet/inventory/hosts/:id/reviews',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: idParams, body: fleetHostReviewCreateSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { note } = req.body as z.infer<typeof fleetHostReviewCreateSchema>;
      await app.db.transaction(async (tx) => {
        const [host] = await tx
          .select({ id: schema.fleetHosts.id })
          .from(schema.fleetHosts)
          .where(eq(schema.fleetHosts.id, id));
        if (!host) throw new AppError('NOT_FOUND', 404, 'Host not found');
        await tx
          .insert(schema.fleetHostReviews)
          .values({ hostId: id, note, reviewedBy: req.userId });
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.inventory.host.review',
          resourceType: 'fleet_host',
          resourceId: id,
          after: { note },
          request: req,
        });
      });
      return load();
    },
  );
}
