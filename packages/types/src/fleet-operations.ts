import { z } from 'zod';

// Fleet operations: maintenance windows (silence alerts for a worker) and reservation notes
// (who has a worker and why; no routing effect). Every write carries a reason for the audit trail.

const reason = z.string().trim().min(3).max(300);
const owner = z.string().trim().min(1).max(80);
const workerId = z.string().min(1).max(100);

export const fleetMaintenanceViewSchema = z.object({
  id: z.string().uuid(),
  workerId,
  startsAt: z.string(),
  endsAt: z.string(),
  owner: z.string(),
  reason: z.string(),
  // SCHEDULED: not started yet. ACTIVE: silencing alerts now. ENDED/CANCELLED: history.
  status: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']),
  createdAt: z.string(),
});
export type FleetMaintenanceView = z.infer<typeof fleetMaintenanceViewSchema>;

export const fleetReservationViewSchema = z.object({
  workerId,
  owner: z.string(),
  reason: z.string(),
  until: z.string().nullable(),
  createdAt: z.string(),
});
export type FleetReservationView = z.infer<typeof fleetReservationViewSchema>;

export const fleetOperationsSchema = z.object({
  generatedAt: z.string(),
  maintenance: z.array(fleetMaintenanceViewSchema),
  reservations: z.array(fleetReservationViewSchema),
});
export type FleetOperations = z.infer<typeof fleetOperationsSchema>;

export const fleetMaintenanceCreateSchema = z.object({
  workerId,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  owner,
  reason,
});

export const fleetMaintenanceCancelSchema = z.object({ reason });

export const fleetReservationSetSchema = z.object({
  owner,
  until: z.string().datetime().nullable(),
  reason,
});

export const fleetReservationReleaseSchema = z.object({ reason });
