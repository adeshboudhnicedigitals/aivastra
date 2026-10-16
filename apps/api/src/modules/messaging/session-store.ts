import type { FastifyInstance } from 'fastify';
import type { Session } from './engine/types.js';

type RedisClient = FastifyInstance['redis'];
// Matches Meta's 24-hour customer-service window: after it, the conversation
// starts over anyway (spec section 8).
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const key = (channel: string, externalId: string) => `msg:session:${channel}:${externalId}`;

export async function loadSession(
  redis: RedisClient,
  channel: string,
  externalId: string,
): Promise<Session | null> {
  const raw = await redis.get(key(channel, externalId));
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  // A session written by an incompatible engine version starts over cleanly.
  return s.v === 1 ? s : null;
}

export async function saveSession(
  redis: RedisClient,
  channel: string,
  externalId: string,
  session: Session,
): Promise<void> {
  await redis.set(key(channel, externalId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}
