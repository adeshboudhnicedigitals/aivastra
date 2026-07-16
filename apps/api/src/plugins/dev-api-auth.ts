import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { API_KEY_RE, extractBearer, hashApiKey } from '../modules/dev/keys.js';

export const devApiAuthPlugin = fp(async (app) => {
  app.decorate('requireApiKey', async (req, _reply) => {
    const key = extractBearer(req.headers.authorization);
    if (!key) throw new AppError('UNAUTHORIZED', 401, 'Missing Authorization: Bearer <api key>');

    // Format guard BEFORE the DB round trip. Same reasoning as the UUID guard in
    // shopify-widget-auth.ts: a malformed value must not reach Postgres, where it
    // would surface as an unhandled error (500) instead of the intended 401. It
    // also keeps junk traffic off the database entirely.
    if (!API_KEY_RE.test(key)) throw new AppError('UNAUTHORIZED', 401, 'Invalid API key');

    // Lookup is by hash on a unique index — an index probe, not a string compare,
    // so there is no timing oracle on the key material.
    const [row] = await app.db
      .select({
        id: schema.apiKeys.id,
        revokedAt: schema.apiKeys.revokedAt,
        merchantId: schema.merchants.id,
        merchantIsActive: schema.merchants.isActive,
        merchantUserId: schema.merchants.userId,
      })
      .from(schema.apiKeys)
      .innerJoin(schema.merchants, eq(schema.merchants.id, schema.apiKeys.merchantId))
      .where(eq(schema.apiKeys.keyHash, hashApiKey(key)))
      .limit(1);

    // One opaque message for every failure mode — never reveal whether a key
    // exists, is revoked, or belongs to a deactivated merchant.
    if (!row || row.revokedAt || !row.merchantIsActive) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid API key');
    }

    req.apiKeyId = row.id;
    req.merchantId = row.merchantId;
    req.merchantUserId = row.merchantUserId;

    // lastUsedAt is dashboard telemetry, not a security control: throttle to ~1
    // write/min/key so a busy key does not add a write to every request, and never
    // let a failure here break the request.
    void (async () => {
      try {
        const ok = await app.redis.set(`apikey:lastused:${row.id}`, '1', 'EX', 60, 'NX');
        if (ok === 'OK') {
          await app.db
            .update(schema.apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(and(eq(schema.apiKeys.id, row.id)));
        }
      } catch (err) {
        app.log.warn({ err, apiKeyId: row.id }, 'failed to record api key lastUsedAt');
      }
    })();
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyId?: string;
    merchantId?: string;
    merchantUserId?: string;
  }
  interface FastifyInstance {
    requireApiKey: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
