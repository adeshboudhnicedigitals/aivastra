import type { Redis } from 'ioredis';
import { z } from 'zod';
import { boundedRead } from '../worker/bounded-read.js';

export const COMFY_TIMEOUT_CONFIG_KEY = 'config:comfy-timeout';
// Fallback for direct callers; the dispatcher passes its validated env setting.
export const POLL_INTERVAL_MS = 3_000;
export const QUEUE_CLEANUP_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
// One /history poll that times out or errors says nothing about the prompt: it is usually still
// running on the GPU. A job fails only when polls keep failing for this long AND at least this
// many in a row have failed, so a single 10 s hang can never count as an outage by itself. 30 s
// is three of the 10 s request timeouts (about nine poll intervals); the execution deadline still
// bounds everything.
export const POLL_REQUEST_TIMEOUT_MS = 10_000;
export const POLL_OUTAGE_MS = 30_000;
export const POLL_OUTAGE_MIN_FAILURES = 3;
export const comfyTimeoutConfigSchema = z
  .object({
    queueCleanupTimeoutMs: z.number().int().positive().default(30_000),
    maxQueueWaitMs: z.number().int().positive().optional(),
    queueStateUnknownGraceMs: z.number().int().positive().default(10_000),
    cancelConfirmationTimeoutMs: z.number().int().positive().default(20_000),
    cancelAbsentRecheckMs: z.number().int().positive().default(2_000),
    requestTimeoutMs: z.number().int().positive().default(5_000),
    pollRequestTimeoutMs: z.number().int().positive().default(POLL_REQUEST_TIMEOUT_MS),
    pollOutageMs: z.number().int().positive().default(POLL_OUTAGE_MS),
    pollOutageMinFailures: z.number().int().positive().default(POLL_OUTAGE_MIN_FAILURES),
  })
  .strict()
  .refine(
    (config) =>
      config.queueCleanupTimeoutMs >= config.queueStateUnknownGraceMs + 2 * POLL_INTERVAL_MS,
    { message: 'Queue cleanup budget must cover unknown-state grace and two polls' },
  );
export type ComfyTimeoutConfig = z.infer<typeof comfyTimeoutConfigSchema>;

export async function getComfyTimeoutConfig(redis: Redis): Promise<{
  config: ComfyTimeoutConfig;
  reason?: string;
}> {
  try {
    const raw = await boundedRead(() => redis.get(COMFY_TIMEOUT_CONFIG_KEY), 5_000);
    const parsed = comfyTimeoutConfigSchema.safeParse(raw === null ? {} : JSON.parse(raw));
    if (parsed.success)
      return {
        config: parsed.data,
        reason: parsed.data.maxQueueWaitMs ? undefined : 'queue_budget_unset',
      };
  } catch {
    /* Invalid config disables queue-aware timeout, never safe cancellation. */
  }
  return { config: comfyTimeoutConfigSchema.parse({}), reason: 'queue_budget_unreadable' };
}
