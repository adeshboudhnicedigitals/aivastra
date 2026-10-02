import { z } from 'zod';

export const capabilityNames = [
  'queuePromptIdentityValidated',
  'queueDeleteValidated',
  'promptScopedInterruptValidated',
] as const;

export const workerCapabilitiesSchema = z
  .object({
    queuePromptIdentityValidated: z.boolean().optional(),
    queueDeleteValidated: z.boolean().optional(),
    promptScopedInterruptValidated: z.boolean().optional(),
    validatedComfyVersion: z.string().min(1).optional(),
    validatedAt: z.string().min(1).optional(),
    // A recorded two-real-prompts validation is required before scoped interrupt enablement.
    validationReference: z.string().min(1).optional(),
  })
  .strict();
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>;
export type CapabilityRead =
  | { status: 'not_configured'; capabilities?: WorkerCapabilities }
  | { status: 'configured'; capabilities: WorkerCapabilities }
  | { status: 'unreadable' };

export const capabilitiesKey = (id: string) => `worker:capabilities:${id}`;
export const comfyVersionKey = (id: string) => `worker:comfy-version:${id}`;

export function parseCapabilities(raw: string | null): CapabilityRead {
  if (raw === null) return { status: 'not_configured' };
  try {
    const parsed = workerCapabilitiesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'unreadable' };
    const capabilities = parsed.data;
    if (!capabilityNames.some((name) => capabilities[name] === true)) {
      return { status: 'not_configured', capabilities };
    }
    if (!capabilities.validatedComfyVersion || !capabilities.validatedAt) {
      return { status: 'unreadable' };
    }
    return { status: 'configured', capabilities };
  } catch {
    return { status: 'unreadable' };
  }
}

// The API enforces DRAINING only; verifying an empty ComfyUI queue is an operator step.
export function capabilityMutationError(
  before: CapabilityRead,
  next: WorkerCapabilities | null,
  draining: boolean,
  gateOn: boolean,
): string | undefined {
  if (before.status === 'unreadable' && !draining)
    return 'Drain before repairing unreadable capabilities';
  const after = parseCapabilities(next === null ? null : JSON.stringify(next));
  if (after.status === 'unreadable')
    return 'Configured capabilities require version and validation date';
  const old = before.status === 'unreadable' ? undefined : before.capabilities;
  if (before.status === 'configured' && after.status !== 'configured' && !draining) {
    return 'Drain and verify an empty queue before clearing capabilities';
  }
  if (
    before.status === 'configured' &&
    next?.validatedComfyVersion !== old?.validatedComfyVersion &&
    !draining
  ) {
    return 'Drain and revalidate before changing the validated version';
  }
  if (
    next &&
    capabilityNames.some((name) => next[name] === true && old?.[name] !== true) &&
    !gateOn
  ) {
    return 'Enable the queue gate before enabling any capability';
  }
  if (next?.promptScopedInterruptValidated === true && !next.validationReference) {
    return 'A recorded two-real-prompts validation reference is required';
  }
  return undefined;
}
