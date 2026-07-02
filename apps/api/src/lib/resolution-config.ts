import { RESOLUTION_COSTS, type Resolution } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';

const CONFIG_KEY = 'config:system';

export const DEFAULT_RESOLUTION_CONFIG: Record<
  Resolution,
  { enabled: boolean; creditCost: number }
> = {
  HD: { enabled: false, creditCost: RESOLUTION_COSTS.HD },
  '2K': { enabled: true, creditCost: RESOLUTION_COSTS['2K'] },
  '4K': { enabled: true, creditCost: RESOLUTION_COSTS['4K'] },
};

/**
 * Reads the admin-configured credit cost for a resolution from the same
 * `config:system` Redis key the admin panel edits (GET/PATCH /admin/config).
 * Falls back to the hardcoded RESOLUTION_COSTS default if nothing is stored
 * yet, or the entry is missing/malformed.
 */
export async function getResolutionCreditCost(
  app: FastifyInstance,
  resolution: Resolution,
): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const resolutions = cfg.resolutions ?? DEFAULT_RESOLUTION_CONFIG;
    const cost = resolutions?.[resolution]?.creditCost;
    return typeof cost === 'number' ? cost : RESOLUTION_COSTS[resolution];
  } catch {
    return RESOLUTION_COSTS[resolution];
  }
}
