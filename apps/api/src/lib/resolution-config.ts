import {
  PIXVERSE_VIDEO_COST,
  RESOLUTION_COSTS,
  type Resolution,
  SAREE_MANNEQUIN_DEV_COST,
  SIMPLE_TRYON_COST,
} from '@aivastra/types';
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

export const DEFAULT_MAX_OUTPUT_PX = 2048;

export const DEFAULT_TRYON_CONFIG: { creditCost: number } = {
  creditCost: SIMPLE_TRYON_COST,
};

export const DEFAULT_SAREE_MANNEQUIN_DEV_CONFIG: { creditCost: number } = {
  creditCost: SAREE_MANNEQUIN_DEV_COST,
};

export const DEFAULT_PIXVERSE_CONFIG: { creditCost: number } = { creditCost: PIXVERSE_VIDEO_COST };

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

/**
 * Reads the admin-configured platform-wide max output resolution (long edge, px)
 * from the same `config:system` Redis key. Applies once, globally, to every
 * job-creation path that accepts a custom outputWidth/outputHeight — enforced
 * here, before enqueue, so the dispatcher never has to reason about it per template.
 */
export async function getMaxOutputPx(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const max = cfg.maxOutputPx;
    return typeof max === 'number' ? max : DEFAULT_MAX_OUTPUT_PX;
  } catch {
    return DEFAULT_MAX_OUTPUT_PX;
  }
}

/**
 * Reads the admin-configured credit cost for a virtual try-on job (simple
 * tryon + saree) from the same `config:system` Redis key the admin panel
 * edits (GET/PATCH /admin/config). Falls back to SIMPLE_TRYON_COST if
 * nothing is stored yet, or the entry is missing/malformed.
 */
export async function getTryonCreditCost(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const cost = cfg.tryon?.creditCost;
    return typeof cost === 'number' ? cost : SIMPLE_TRYON_COST;
  } catch {
    return SIMPLE_TRYON_COST;
  }
}

/**
 * Reads the admin-configured credit cost for the dev-API saree-mannequin
 * (step-1) job from the same `config:system` Redis key. Kept separate from
 * getTryonCreditCost() — this is a standalone, real-GPU dev-API call, not
 * the shared tryon/saree-step2 price. Falls back to SAREE_MANNEQUIN_DEV_COST
 * if nothing is stored yet, or the entry is missing/malformed.
 */
export async function getSareeMannequinDevCreditCost(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const cost = cfg.sareeMannequinDev?.creditCost;
    return typeof cost === 'number' ? cost : SAREE_MANNEQUIN_DEV_COST;
  } catch {
    return SAREE_MANNEQUIN_DEV_COST;
  }
}

export async function getPixverseCreditCost(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const cost = cfg.pixverse?.creditCost;
    return typeof cost === 'number' ? cost : PIXVERSE_VIDEO_COST;
  } catch {
    return PIXVERSE_VIDEO_COST;
  }
}
