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
  const s = JSON.parse(raw) as Session & { recognition?: unknown };
  // A session written by an incompatible engine version starts over cleanly.
  if (s.v !== 1) return null;
  // Flow 2: pose picking became a count question and recognition no longer
  // rides in the session; a session saved mid-step by the old flow carries on.
  const state = s.state as string;
  // The nonce is reset on a mapped state: the seller's old buttons still carry
  // it, and a match would land in reprompt() with no way forward. A mismatch
  // takes the engine's stale path, which re-sends the new step's prompt.
  if (state === 'PICK_LOOKS' || state === 'CONFIRM_GARMENT_TYPE') {
    s.state = state === 'PICK_LOOKS' ? 'ASK_POSE_COUNT' : 'ASK_GARMENT_TYPE';
    s.nonce = 'migrated';
  }
  delete s.recognition;
  return s;
}

export async function saveSession(
  redis: RedisClient,
  channel: string,
  externalId: string,
  session: Session,
): Promise<void> {
  await redis.set(key(channel, externalId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}
