import type { DB } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import { ownedJobCount, retireSessionOwnership } from './job/ownership.js';
import { markConsumerRetired } from './stream/recovery.js';

/** The application drain never exceeds this; the container stop grace must stay above it. */
export const MAX_DRAIN_MS = 5_000;

/**
 * Called after the consumers have stopped claiming. Gives already-started paid work a short
 * chance to finish, then hands the rest over without a business failure or refund: owned control
 * rows are retired (a replacement may adopt at once) and this consumer is marked retired so its
 * PEL entries, including a claim made but not yet started, are recovered promptly. The PEL
 * itself is kept; nothing is ACKed or re-queued here.
 */
export async function drainAndRetire(args: {
  db: DB;
  redis: Redis;
  log: Logger;
  session: string;
  drainMs: number;
}): Promise<void> {
  const { db, redis, log, session } = args;
  const drainMs = Math.max(0, Math.min(args.drainMs, MAX_DRAIN_MS));
  const until = Date.now() + drainMs;
  while (ownedJobCount() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  const stillOwned = ownedJobCount();
  // The marker first: a crash between the two steps leaves entries recoverable, never a
  // retired row nobody will look at.
  await markConsumerRetired(redis).catch((err) => log.warn({ err }, 'consumer marker not set'));
  const retired = await retireSessionOwnership(db, session).catch((err) => {
    log.error({ err }, 'could not retire owned jobs; their leases will expire on their own');
    return -1;
  });
  log.info({ stillOwned, retired }, 'drained: owned jobs handed over');
}
