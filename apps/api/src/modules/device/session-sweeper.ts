import { schema } from '@aivastra/db';
import { and, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordEvents } from '../analytics/record.js';

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
  // One transaction: a session ended here always has its session_ended event, and the
  // `ended_at is null` predicate means a session the device ended first (writing its own
  // 'done' event) is not returned, so it is never ended or counted twice.
  const rows = await app.db.transaction(async (tx) => {
    const ended = await tx
      .update(schema.instoreSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          isNull(schema.instoreSessions.endedAt),
          lt(schema.instoreSessions.lastActivityAt, cutoff),
        ),
      )
      .returning();
    await recordEvents(
      tx,
      ended.map((s) => ({
        event: 'session_ended' as const,
        merchantId: s.merchantId,
        branchId: s.branchId,
        deviceId: s.deviceId,
        staffId: s.staffId,
        sessionId: s.id,
        channel: s.mode,
        props: { reason: 'idle' },
        occurredAt: s.endedAt ?? undefined,
      })),
    );
    return ended;
  });
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
