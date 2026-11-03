import { z } from 'zod';

// Operator-requested actions on a GPU worker, and who is told about incidents.

// ---- Commands ---------------------------------------------------------------------------------

/**
 * restart_comfyui: restart the ComfyUI service on the box (needs root on the box).
 * clear_queue:     drop ComfyUI's pending prompts (loopback API call, no root).
 * Both are refused unless the worker is drained and holds no reservation; see commands-core.ts.
 */
export const FLEET_COMMAND_KINDS = ['restart_comfyui', 'clear_queue'] as const;
export type FleetCommandKind = (typeof FLEET_COMMAND_KINDS)[number];
export const fleetCommandKindSchema = z.enum(FLEET_COMMAND_KINDS);

export const FLEET_COMMAND_STATES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export const fleetCommandStateSchema = z.enum(FLEET_COMMAND_STATES);
export type FleetCommandState = z.infer<typeof fleetCommandStateSchema>;

/** A request nobody picked up within this long is cancelled rather than run late. */
export const FLEET_COMMAND_EXPIRY_MS = 10 * 60 * 1000;

export const fleetCommandCreateSchema = z.object({
  kind: fleetCommandKindSchema,
  reason: z.string().trim().min(3).max(300),
});

export const fleetCommandViewSchema = z.object({
  id: z.string().uuid(),
  workerId: z.string(),
  kind: fleetCommandKindSchema,
  reason: z.string(),
  state: fleetCommandStateSchema,
  requestedAt: z.string(),
  claimedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  // Plain outcome text from the executor, bounded; never raw command output.
  result: z.string().nullable(),
});
export type FleetCommandView = z.infer<typeof fleetCommandViewSchema>;

export const fleetCommandsSchema = z.object({
  workerId: z.string(),
  generatedAt: z.string(),
  commands: z.array(fleetCommandViewSchema).max(50),
});

// ---- Alert recipients -------------------------------------------------------------------------

export const FLEET_ALERT_EMAILS_MAX = 20;
const email = z.string().trim().toLowerCase().email().max(254);

export const fleetNotificationSettingsPatchSchema = z.object({
  emails: z.array(email).max(FLEET_ALERT_EMAILS_MAX),
});

export const fleetNotificationSettingsSchema = z.object({
  generatedAt: z.string(),
  emails: z.array(z.string()),
  // dashboard: saved here (an empty list means off on purpose). env: nothing saved, so the server
  // environment's list applies. none: nothing configured, no alert email is sent.
  source: z.enum(['dashboard', 'env', 'none']),
  updatedAt: z.string().nullable(),
});
export type FleetNotificationSettings = z.infer<typeof fleetNotificationSettingsSchema>;
