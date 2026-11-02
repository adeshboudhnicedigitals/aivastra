import { z } from 'zod';

// Fleet alert rules and incidents (docs/fleet-agent-design.md section 7).
//
// The catalog below is the single source of truth for which rules exist and their default
// thresholds. The migration seeds `fleet_alert_rules` from the same numbers, and a test fails if
// the two disagree. Only rules the evaluator actually implements are listed: a rule that is
// "enabled" but can never fire would mislead the operator reading the list.

export const fleetAlertSeverities = ['info', 'warning', 'critical'] as const;
export type FleetAlertSeverity = (typeof fleetAlertSeverities)[number];

export const fleetIncidentStates = ['OPEN', 'ACK', 'RECOVERED'] as const;
export type FleetIncidentState = (typeof fleetIncidentStates)[number];

export const fleetIncidentEventKinds = ['OPENED', 'ESCALATED', 'ACK', 'NOTE', 'RECOVERED'] as const;
export type FleetIncidentEventKind = (typeof fleetIncidentEventKinds)[number];

export type FleetAlertParamDef = {
  default: number;
  min: number;
  max: number;
  unit: string;
  label: string;
};
type RuleDef = {
  description: string;
  severity: FleetAlertSeverity;
  /** The condition must hold this long before an incident opens (no flapping on one bad sample). */
  forSeconds: number;
  /** ...and must be clear this long before it recovers. */
  clearSeconds: number;
  params: Record<string, FleetAlertParamDef>;
};

export const FLEET_ALERT_RULES = {
  agent_silent: {
    description:
      'The fleet agent on a box has stopped sending samples. Starts as a warning; escalates to critical if it stays silent.',
    severity: 'warning',
    forSeconds: 90,
    clearSeconds: 30,
    params: {
      criticalAfterSeconds: {
        default: 300,
        min: 120,
        max: 3600,
        unit: 's',
        label: 'Escalate to critical after',
      },
    },
  },
  comfy_down_box_up: {
    description:
      'The dispatcher cannot reach ComfyUI on a worker, but the box and its agent are alive. The worker cannot take jobs.',
    severity: 'critical',
    forSeconds: 60,
    clearSeconds: 30,
    params: {},
  },
  box_unreachable: {
    description:
      'Neither the agent nor the dispatcher can reach the box. It is down, or cut off from the network.',
    severity: 'critical',
    forSeconds: 120,
    clearSeconds: 30,
    params: {},
  },
  thermal_collapse: {
    description:
      'The GPU is hot and its SM clock has fallen far below its maximum. nvidia-smi reports no throttle reason on these cards, so this is inferred from temperature plus the clock ratio.',
    severity: 'warning',
    forSeconds: 180,
    clearSeconds: 120,
    params: {
      clockRatioBelow: {
        default: 0.6,
        min: 0.1,
        max: 0.95,
        unit: 'ratio',
        label: 'Clock ratio below',
      },
      tempAtLeastC: { default: 80, min: 50, max: 110, unit: '°C', label: 'Temperature at least' },
    },
  },
  thermal_slowdown: {
    description:
      'The driver reports it slowed the GPU for heat during the last 15 minutes. Read from the hardware thermal-slowdown counter, which moves even though the throttle bitmask stays 0x0 on these cards.',
    severity: 'warning',
    forSeconds: 60,
    clearSeconds: 600,
    params: {
      slowedSecondsAbove: {
        default: 30,
        min: 1,
        max: 900,
        unit: 's',
        label: 'Slowed for more than',
      },
    },
  },
  gpu_temp_high: {
    description: 'A GPU has stayed above the temperature threshold.',
    severity: 'warning',
    forSeconds: 300,
    clearSeconds: 120,
    params: {
      tempAtLeastC: { default: 88, min: 60, max: 110, unit: '°C', label: 'Temperature at least' },
    },
  },
  disk_high: {
    description: 'A disk, or its inode table, is nearly full.',
    severity: 'warning',
    forSeconds: 60,
    clearSeconds: 300,
    params: {
      usedPctAtLeast: { default: 90, min: 50, max: 100, unit: '%', label: 'Disk used at least' },
      inodePctAtLeast: { default: 90, min: 50, max: 100, unit: '%', label: 'Inodes used at least' },
    },
  },
  swap_active: {
    description:
      'The box is swapping. On these workers swapping means the models no longer fit in RAM.',
    severity: 'info',
    forSeconds: 600,
    clearSeconds: 600,
    params: {
      swapUsedMibAbove: {
        default: 1024,
        min: 64,
        max: 65536,
        unit: 'MiB',
        label: 'Swap used above',
      },
    },
  },
  ram_low: {
    description: 'Available host RAM is very low.',
    severity: 'warning',
    forSeconds: 300,
    clearSeconds: 300,
    params: {
      availablePctBelow: { default: 10, min: 1, max: 50, unit: '%', label: 'Available below' },
    },
  },
  foreign_vram: {
    description:
      'GPU memory is in use that the agent cannot attribute to this worker. Only raised when per-process data is visible; on shared pods it stays quiet because the answer is unknown.',
    severity: 'info',
    forSeconds: 300,
    clearSeconds: 300,
    params: {
      foreignMibAbove: {
        default: 4096,
        min: 256,
        max: 262144,
        unit: 'MiB',
        label: 'Foreign VRAM above',
      },
    },
  },
  clock_skew: {
    description:
      'The box clock differs from the server clock. Samples near the limit are refused, and every timestamp from this box is suspect.',
    severity: 'info',
    forSeconds: 300,
    clearSeconds: 300,
    params: { skewSecondsAbove: { default: 30, min: 5, max: 300, unit: 's', label: 'Skew above' } },
  },
  ingest_rejected: {
    description:
      'The agent is reaching the server but its samples are being refused (invalid payload, wrong worker, or a bad clock).',
    severity: 'warning',
    forSeconds: 0,
    clearSeconds: 600,
    params: {
      rejectsAtLeast: {
        default: 10,
        min: 1,
        max: 1000,
        unit: 'per hour',
        label: 'Rejected at least',
      },
    },
  },
} as const satisfies Record<string, RuleDef>;

export type FleetAlertRuleKey = keyof typeof FLEET_ALERT_RULES;
export const fleetAlertRuleKeys = Object.keys(FLEET_ALERT_RULES) as [
  FleetAlertRuleKey,
  ...FleetAlertRuleKey[],
];
export const fleetAlertRuleKeySchema = z.enum(fleetAlertRuleKeys);

// ---- Views -----------------------------------------------------------------------------------

// An admin account can exist without an email, so it is nullable rather than made up.
const person = z.object({ id: z.string(), email: z.string().nullable() });

// Evidence is a flat snapshot taken when the incident opened (e.g. {tempC: 87, clockRatio: 0.37}).
// Flat scalars only, so the UI can render it as a key/value list without knowing each rule.
export const fleetEvidenceSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const fleetIncidentSchema = z.object({
  id: z.string(),
  ruleKey: fleetAlertRuleKeySchema,
  workerId: z.string(),
  state: z.enum(fleetIncidentStates),
  severity: z.enum(fleetAlertSeverities),
  summary: z.string(),
  evidence: fleetEvidenceSchema,
  openedAt: z.string(),
  ackedAt: z.string().nullable(),
  ackedBy: person.nullable(),
  recoveredAt: z.string().nullable(),
});
export type FleetIncident = z.infer<typeof fleetIncidentSchema>;

export const fleetIncidentEventSchema = z.object({
  id: z.number().int(),
  kind: z.enum(fleetIncidentEventKinds),
  at: z.string(),
  // null = the system (the evaluator), not a person.
  actor: person.nullable(),
  text: z.string().nullable(),
});
export type FleetIncidentEvent = z.infer<typeof fleetIncidentEventSchema>;

export const fleetIncidentListSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().min(0),
  items: z.array(fleetIncidentSchema),
});

export const fleetIncidentDetailSchema = z.object({
  generatedAt: z.string(),
  incident: fleetIncidentSchema,
  // Oldest first.
  events: z.array(fleetIncidentEventSchema),
});

// What the dashboard banner polls. Counts only incidents that are not recovered.
export const fleetIncidentSummarySchema = z.object({
  generatedAt: z.string(),
  open: z.number().int().min(0),
  acknowledged: z.number().int().min(0),
  bySeverity: z.object({
    critical: z.number().int().min(0),
    warning: z.number().int().min(0),
    info: z.number().int().min(0),
  }),
});

export const fleetAlertRuleParamViewSchema = z.object({
  value: z.number(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  unit: z.string(),
  label: z.string(),
});

export const fleetAlertRuleViewSchema = z.object({
  key: fleetAlertRuleKeySchema,
  description: z.string(),
  severity: z.enum(fleetAlertSeverities),
  enabled: z.boolean(),
  forSeconds: z.number().int().min(0),
  clearSeconds: z.number().int().min(0),
  params: z.record(z.string(), fleetAlertRuleParamViewSchema),
  updatedAt: z.string().nullable(),
});
export type FleetAlertRuleView = z.infer<typeof fleetAlertRuleViewSchema>;

export const fleetAlertRulesSchema = z.object({
  generatedAt: z.string(),
  rules: z.array(fleetAlertRuleViewSchema),
});

// ---- Requests --------------------------------------------------------------------------------

const noteText = z.string().trim().min(3).max(1000);
export const fleetIncidentAckBodySchema = z.object({ note: noteText.optional() }).nullish();
export const fleetIncidentNoteBodySchema = z.object({ text: noteText });

export const fleetIncidentListQuerySchema = z.object({
  // Comma separated, e.g. "OPEN,ACK". Omitted = every state.
  state: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(z.enum(fleetIncidentStates)).min(1).optional()),
  workerId: z.string().min(1).max(100).optional(),
  severity: z.enum(fleetAlertSeverities).optional(),
  ruleKey: fleetAlertRuleKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const fleetAlertRulePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    severity: z.enum(fleetAlertSeverities).optional(),
    forSeconds: z.number().int().min(0).max(86_400).optional(),
    clearSeconds: z.number().int().min(0).max(86_400).optional(),
    params: z.record(z.string(), z.number().finite()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
