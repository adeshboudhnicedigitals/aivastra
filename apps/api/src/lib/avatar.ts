import type { FastifyInstance } from 'fastify';

// Short enough that a removed picture stops resolving soon, long enough that a
// page open for a while doesn't show broken images. Signing is local, so doing
// this per row of a 200-row admin list costs no storage round trips.
const AVATAR_URL_TTL_SEC = 3600;

/** A browser-loadable URL for a stored avatar key, or null when the user has none. */
export async function avatarUrlFor(
  app: FastifyInstance,
  key: string | null | undefined,
): Promise<string | null> {
  if (!key) return null;
  return (await app.storage.presignGet(key, AVATAR_URL_TTL_SEC)).url;
}
