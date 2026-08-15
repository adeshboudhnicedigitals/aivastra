import { schema } from '@aivastra/db';
import { DEFAULT_MAX_QUEUE_DEPTH } from '@aivastra/types';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

const CONFIG_KEY = 'config:system';

// The three sources that land QUEUED immediately off the Studio/catalogue path
// and therefore compete for a worker inside the sweeper's 10-minute SLA. Does
// NOT include catalog_video (own lane, own 30-minute SLA — see sweeper.ts) or
// the saree-mannequin step-2 rows, which insert as PENDING_MANNEQUIN, not
// QUEUED, until promoted later (see createSareeMannequinJob).
const QUEUE_CAPPED_SOURCES = ['catalog', 'saree', 'saree_mannequin'] as const;

/**
 * Reads the admin-configured ceiling on concurrently QUEUED catalog-path jobs
 * from the same `config:system` Redis key the admin panel edits (GET/PATCH
 * /admin/config), mirroring getMaxBatchJobs() in batch-config.ts. Falls back to
 * DEFAULT_MAX_QUEUE_DEPTH when nothing is stored or the entry is malformed.
 */
export async function getMaxQueueDepth(app: FastifyInstance): Promise<number> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const max = cfg.maxQueueDepth;
    return typeof max === 'number' && max > 0 ? max : DEFAULT_MAX_QUEUE_DEPTH;
  } catch {
    return DEFAULT_MAX_QUEUE_DEPTH;
  }
}

/**
 * Rejects a job submission before any credit/DB work if accepting it would push
 * the system-wide QUEUED count (across QUEUE_CAPPED_SOURCES) past the admin's
 * ceiling. This is an admission-control gate, not a correctness guard — a
 * concurrent submission can still race past it, same tradeoff createBatchJobs's
 * preflight balance check already accepts (see create.ts comment there).
 */
export async function assertQueueCapacity(
  app: FastifyInstance,
  additionalJobs: number,
): Promise<void> {
  const maxQueueDepth = await getMaxQueueDepth(app);
  const [row] = await app.db
    .select({ c: count() })
    .from(schema.jobs)
    .where(
      and(eq(schema.jobs.status, 'QUEUED'), inArray(schema.jobs.source, QUEUE_CAPPED_SOURCES)),
    );
  const current = row?.c ?? 0;

  if (current + additionalJobs > maxQueueDepth) {
    throw new AppError('SERVER_BUSY', 503, 'server is busy, please try again shortly', {
      current,
      maxQueueDepth,
    });
  }
}
