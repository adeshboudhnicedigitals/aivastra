import { schema } from '@aivastra/db';
import {
  fleetMaintenanceCancelSchema,
  fleetMaintenanceCreateSchema,
  fleetOperationsSchema,
  fleetReservationReleaseSchema,
  fleetReservationSetSchema,
} from '@aivastra/types';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import { reservationError, windowError, windowStatus } from './operations-core.js';

const workerParams = z.object({ id: z.string().min(1).max(100) });
const windowParams = z.object({ id: z.string().uuid() });
// Windows that ended long ago are history nobody needs on the page; the audit log keeps them.
const HISTORY_DAYS = 30;

/**
 * Maintenance windows silence alerts for a worker; reservations are audited notes. Neither changes
 * dispatcher routing (draining and job reservation tokens stay the dispatcher's own state).
 */
export async function fleetOperationsRoutes(app: FastifyInstance) {
  async function load() {
    const now = Date.now();
    const since = new Date(now - HISTORY_DAYS * 86_400_000);
    const windows = await app.db
      .select()
      .from(schema.fleetMaintenanceWindows)
      .where(gt(schema.fleetMaintenanceWindows.endsAt, since))
      .orderBy(desc(schema.fleetMaintenanceWindows.startsAt));
    const reservations = await app.db
      .select()
      .from(schema.fleetReservations)
      .orderBy(asc(schema.fleetReservations.workerId));
    return fleetOperationsSchema.parse({
      generatedAt: new Date(now).toISOString(),
      maintenance: windows.map((w) => ({
        id: w.id,
        workerId: w.workerId,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        owner: w.owner,
        reason: w.reason,
        status: windowStatus(w, now),
        createdAt: w.createdAt.toISOString(),
      })),
      reservations: reservations.map((r) => ({
        workerId: r.workerId,
        owner: r.owner,
        reason: r.reason,
        until: r.until ? r.until.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }

  const actor = (req: { userId: string; adminRole?: unknown }) => ({
    userId: req.userId,
    role: req.adminRole as string,
  });

  async function requireWorker(workerId: string) {
    const [w] = await app.db
      .select({ id: schema.workers.id })
      .from(schema.workers)
      .where(eq(schema.workers.id, workerId));
    if (!w) throw new AppError('NOT_FOUND', 404, `Worker ${workerId} does not exist`);
  }

  app.get('/admin/fleet/operations', { preHandler: requirePermission('fleet.view') }, load);

  app.post(
    '/admin/fleet/operations/maintenance',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { body: fleetMaintenanceCreateSchema },
    },
    async (req) => {
      const b = req.body as z.infer<typeof fleetMaintenanceCreateSchema>;
      const startsAt = Date.parse(b.startsAt);
      const endsAt = Date.parse(b.endsAt);
      const bad = windowError(startsAt, endsAt, Date.now());
      if (bad) throw new AppError('INVALID_WINDOW', 400, bad);
      await requireWorker(b.workerId);
      await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.fleetMaintenanceWindows)
          .values({
            workerId: b.workerId,
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
            owner: b.owner,
            reason: b.reason,
            createdBy: req.userId,
          })
          .returning({ id: schema.fleetMaintenanceWindows.id });
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.maintenance.schedule',
          resourceType: 'fleet_maintenance_window',
          resourceId: row?.id ?? b.workerId,
          before: null,
          after: {
            workerId: b.workerId,
            startsAt: b.startsAt,
            endsAt: b.endsAt,
            owner: b.owner,
            reason: b.reason,
          },
          request: req,
        });
      });
      return load();
    },
  );

  app.post(
    '/admin/fleet/operations/maintenance/:id/cancel',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: windowParams, body: fleetMaintenanceCancelSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof windowParams>;
      const { reason } = req.body as z.infer<typeof fleetMaintenanceCancelSchema>;
      await app.db.transaction(async (tx) => {
        const [w] = await tx
          .select()
          .from(schema.fleetMaintenanceWindows)
          .where(eq(schema.fleetMaintenanceWindows.id, id));
        if (!w) throw new AppError('NOT_FOUND', 404, 'Maintenance window not found');
        const status = windowStatus(w, Date.now());
        if (status === 'CANCELLED' || status === 'ENDED')
          throw new AppError(
            'NOT_CANCELLABLE',
            409,
            `This window is already ${status.toLowerCase()}.`,
          );
        // Guarded update: two operators cancelling at once record one audit row.
        const [done] = await tx
          .update(schema.fleetMaintenanceWindows)
          .set({ state: 'CANCELLED', cancelledBy: req.userId, cancelledAt: new Date() })
          .where(
            and(
              eq(schema.fleetMaintenanceWindows.id, id),
              eq(schema.fleetMaintenanceWindows.state, 'SCHEDULED'),
            ),
          )
          .returning({ id: schema.fleetMaintenanceWindows.id });
        if (!done) throw new AppError('NOT_CANCELLABLE', 409, 'This window is already cancelled.');
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.maintenance.cancel',
          resourceType: 'fleet_maintenance_window',
          resourceId: id,
          before: { workerId: w.workerId, status },
          after: { status: 'CANCELLED', reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.put(
    '/admin/fleet/operations/reservations/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: workerParams, body: fleetReservationSetSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const b = req.body as z.infer<typeof fleetReservationSetSchema>;
      const until = b.until === null ? null : Date.parse(b.until);
      const bad = reservationError(until, Date.now());
      if (bad) throw new AppError('INVALID_RESERVATION', 400, bad);
      await requireWorker(id);
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.fleetReservations)
          .where(eq(schema.fleetReservations.workerId, id));
        const values = {
          owner: b.owner,
          reason: b.reason,
          until: until === null ? null : new Date(until),
          createdBy: req.userId,
        };
        await tx
          .insert(schema.fleetReservations)
          .values({ workerId: id, ...values })
          .onConflictDoUpdate({
            target: schema.fleetReservations.workerId,
            set: { ...values, createdAt: new Date() },
          });
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.reservation.set',
          resourceType: 'fleet_reservation',
          resourceId: id,
          before: before
            ? {
                owner: before.owner,
                reason: before.reason,
                until: before.until ? before.until.toISOString() : null,
              }
            : null,
          after: { owner: b.owner, reason: b.reason, until: b.until, note: b.reason },
          request: req,
        });
      });
      return load();
    },
  );

  app.delete(
    '/admin/fleet/operations/reservations/:id',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: workerParams, body: fleetReservationReleaseSchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const { reason } = req.body as z.infer<typeof fleetReservationReleaseSchema>;
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .delete(schema.fleetReservations)
          .where(eq(schema.fleetReservations.workerId, id))
          .returning();
        if (!before) throw new AppError('NOT_FOUND', 404, 'No reservation on this worker');
        await recordAudit(tx, {
          actor: actor(req),
          action: 'fleet.reservation.release',
          resourceType: 'fleet_reservation',
          resourceId: id,
          before: {
            owner: before.owner,
            reason: before.reason,
            until: before.until ? before.until.toISOString() : null,
          },
          after: { reason },
          request: req,
        });
      });
      return load();
    },
  );
}
