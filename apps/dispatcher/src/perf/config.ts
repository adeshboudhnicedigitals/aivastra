import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { z } from 'zod';

export type SelectionMode = 'off' | 'observe' | 'active';
export const PERF_CONFIG_KEY = 'config:perf-routing';
export const PERF_TTL_SECONDS = 14 * 24 * 60 * 60;
export const MIN_SAMPLES = 5;
export const AGE_DECAY_MS = 24 * 60 * 60 * 1000;

export interface PerfConfig {
  mode: SelectionMode;
  pools?: Partial<Record<WorkerPool, SelectionMode>>;
  baselineMs: number;
  poolBaselines?: Partial<Record<WorkerPool, number>>;
  alpha: number;
  probeBackoffMs: number;
  cacheExcludeThreshold?: number;
  cachePolicyFrozen: boolean;
}

export const DEFAULT_PERF_CONFIG: PerfConfig = {
  mode: 'off',
  baselineMs: 60_000,
  alpha: 0.2,
  probeBackoffMs: 20_000,
  cachePolicyFrozen: false,
};

const modeSchema = z.enum(['off', 'observe', 'active']);
const configSchema = z.object({
  mode: modeSchema,
  pools: z.record(modeSchema).optional(),
  baselineMs: z.number().positive().finite().default(DEFAULT_PERF_CONFIG.baselineMs),
  poolBaselines: z.record(z.number().positive().finite()).optional(),
  alpha: z.number().positive().max(1).default(DEFAULT_PERF_CONFIG.alpha),
  probeBackoffMs: z.number().min(15_000).max(30_000).default(DEFAULT_PERF_CONFIG.probeBackoffMs),
  cacheExcludeThreshold: z.number().int().nonnegative().optional(),
  cachePolicyFrozen: z.boolean().default(false),
});

export async function readPerfConfig(redis: Redis): Promise<PerfConfig> {
  try {
    const raw = await redis.get(PERF_CONFIG_KEY);
    if (!raw) return DEFAULT_PERF_CONFIG;
    const parsed = configSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PERF_CONFIG;
  } catch {
    return DEFAULT_PERF_CONFIG;
  }
}
