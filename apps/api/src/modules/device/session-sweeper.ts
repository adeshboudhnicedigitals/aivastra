import { schema } from '@aivastra/db';
import { and, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const IDLE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Ends in-store sessions idle for 10 minutes (spec §5.2). Not audited: the sweeper has
 * no actor, and audit_logs.actor_user_id is NOT NULL.
 */
export async function runInstoreSessionSweepTick(
  app: FastifyInstance,
  opts: { idleMs?: number } = {},
): Promise<{ ended: number }> {
  const cutoff = new Date(Date.now() - (opts.idleMs ?? IDLE_MS));
  const rows = await app.db
    .update(schema.instoreSessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        isNull(schema.instoreSessions.endedAt),
        lt(schema.instoreSessions.lastActivityAt, cutoff),
      ),
    )
    .returning({ id: schema.instoreSessions.id });
  return { ended: rows.length };
}

export function startInstoreSessionSweeper(
  app: FastifyInstance,
  intervalMs: number = SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runInstoreSessionSweepTick(app)
      .catch((err) => app.log.error({ err }, 'instore session sweeper tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
