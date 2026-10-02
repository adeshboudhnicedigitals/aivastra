import type { Redis } from 'ioredis';
import { z } from 'zod';
import { boundedRead } from '../worker/bounded-read.js';

export const COMFY_TIMEOUT_CONFIG_KEY = 'config:comfy-timeout';
export const POLL_INTERVAL_MS = 3_000;
export const comfyTimeoutConfigSchema = z
  .object({
    queueCleanupTimeoutMs: z.number().int().positive().default(30_000),
    maxQueueWaitMs: z.number().int().positive().optional(),
    queueStateUnknownGraceMs: z.number().int().positive().default(10_000),
    cancelConfirmationTimeoutMs: z.number().int().positive().default(20_000),
    cancelAbsentRecheckMs: z.number().int().positive().default(2_000),
    requestTimeoutMs: z.number().int().positive().default(5_000),
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
