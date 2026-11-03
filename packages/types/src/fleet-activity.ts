import { z } from 'zod';

// The fleet activity log: one time-ordered list of what operators and the system did, assembled from
// the audit trail, incident timelines and finished commands. Read-only; the sources stay authoritative.

export const FLEET_ACTIVITY_SOURCES = ['AUDIT', 'INCIDENT', 'COMMAND'] as const;
export const fleetActivitySourceSchema = z.enum(FLEET_ACTIVITY_SOURCES);
export type FleetActivitySource = z.infer<typeof fleetActivitySourceSchema>;

export const fleetActivityItemSchema = z.object({
  // Prefixed by source so ids from different tables never collide ("audit:<uuid>", "incident:<n>", "command:<uuid>").
  id: z.string(),
  at: z.string(),
  source: fleetActivitySourceSchema,
  // Machine-readable: an audit action ("fleet.command.request"), an incident event kind ("ACK"), or "command.<state>".
  action: z.string(),
  // The acting admin's email; null for the system (opened/recovered incidents, executors).
  actor: z.string().nullable(),
  workerId: z.string().nullable(),
  // One bounded human sentence. Never raw before/after payloads or command output.
  summary: z.string().max(400),
});
export type FleetActivityItem = z.infer<typeof fleetActivityItemSchema>;

export const fleetActivityQuerySchema = z.object({
  // Comma list of sources; omitted = all.
  source: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(fleetActivitySourceSchema)),
  workerId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Merged from several tables, so paging is bounded rather than unbounded.
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

export const fleetActivityListSchema = z.object({
  generatedAt: z.string(),
  items: z.array(fleetActivityItemSchema),
  hasMore: z.boolean(),
});
export type FleetActivityList = z.infer<typeof fleetActivityListSchema>;
