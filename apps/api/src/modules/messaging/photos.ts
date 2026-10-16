import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';

// Same TTL as /v1/uploads/presign (uploads/routes.ts UPLOAD_OWNER_TTL_SEC):
// the hourly upload sweeper treats a chat photo exactly like a web upload.
const UPLOAD_OWNER_TTL_SEC = 24 * 60 * 60;

/**
 * Stores a photo received in the chat as an ordinary garment upload: the same
 * key shape the presign route issues, the same upload:owner binding, so
 * createJob accepts it unchanged, the dispatcher can read it for recognition,
 * and the sweeper removes it if the seller never generates. Size limits are
 * enforced later by createJob's own check, as for the web.
 */
export async function storeGarmentPhoto(
  app: FastifyInstance,
  userId: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const key = keys.inputGarment(randomUUID());
  await app.storage.putObject(key, bytes, contentType);
  await app.redis.set(`upload:owner:${key}`, userId, 'EX', UPLOAD_OWNER_TTL_SEC);
  return key;
}
