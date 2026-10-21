import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// The app's decorated redis type, same as identity.ts uses.
type RedisClient = FastifyInstance['redis'];

// Same window as the upload ownership binding (`upload:owner:<key>`, 24h): the
// studio can only create a job from the garment key while that binding holds,
// so a longer draft would link to a photo the studio can no longer use.
export const DRAFT_TTL_SEC = 24 * 60 * 60;

export interface StudioDraft {
  userId: string;
  gender: string;
  garmentTypeId: string;
  garmentKey: string;
}

const key = (token: string) => `studio:draft:${token}`;

/** Stores a draft and returns its token (128 bits, hex). */
export async function createStudioDraftToken(redis: RedisClient, d: StudioDraft): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await redis.set(key(token), JSON.stringify(d), 'EX', DRAFT_TTL_SEC);
  return token;
}

/**
 * The draft, only to the user it was made for. A token for someone else's draft
 * reads as missing, so the route cannot be used to probe for valid tokens.
 */
export async function readStudioDraft(
  redis: RedisClient,
  token: string,
  userId: string,
): Promise<StudioDraft | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  const d = JSON.parse(raw) as StudioDraft;
  return d.userId === userId ? d : null;
}
