import { z } from 'zod';

// Operator actions on a job from the fleet dashboard. Narrower than the admin panel's own
// cancel/retry on purpose: only work that has not started can be cancelled, and only a failed job
// can be retried. Every action carries a reason that lands in the audit trail.

export const fleetJobActionSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const fleetJobActionResultSchema = z.object({
  ok: z.literal(true),
  jobId: z.string().uuid(),
  status: z.enum(['CANCELLED', 'QUEUED']),
  // Cancel: credits returned to the customer by this action. Retry: whether the failure had
  // already been refunded (the retry then runs without charging again).
  refunded: z.boolean(),
});
export type FleetJobActionResult = z.infer<typeof fleetJobActionResultSchema>;
