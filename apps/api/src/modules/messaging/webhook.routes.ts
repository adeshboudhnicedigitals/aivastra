import type { FastifyInstance } from 'fastify';
import { parseWebhook } from './channels/whatsapp/parse.js';
import { verifySignature } from './channels/whatsapp/signature.js';

export const INBOUND_STREAM = 'messaging:inbound';
// Meta retries for up to a few days; a redelivery older than this is processed again.
const SEEN_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Meta → us. Verify, de-duplicate, enqueue, ack — nothing slow happens here, so
 * Meta never times out and retries, and a crash mid-processing never loses a
 * seller's photo: the consumer picks it up from the stream (spec section 5).
 */
export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.get('/v1/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const expected = app.env.WHATSAPP_VERIFY_TOKEN;
    if (q['hub.mode'] === 'subscribe' && expected && q['hub.verify_token'] === expected) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send();
  });

  // Scoped so the raw-buffer JSON parser (needed for the HMAC) affects only this route.
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );

    sub.post(
      '/v1/whatsapp/webhook',
      // Meta's own delivery volume, not abuse: keep the limiter well out of its way.
      { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return reply.code(200).send();
        const secret = app.env.WHATSAPP_APP_SECRET;
        const raw = req.body as Buffer;
        if (
          !secret ||
          !verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, secret)
        ) {
          app.log.warn('whatsapp webhook: missing or invalid signature — dropped');
          return reply.code(200).send();
        }

        let body: unknown;
        try {
          body = JSON.parse(raw.toString('utf-8'));
        } catch {
          return reply.code(200).send();
        }

        for (const msg of parseWebhook(body)) {
          // SET NX first: a redelivered message never enters the stream twice.
          const fresh = await app.redis.set(
            `msg:seen:whatsapp:${msg.messageId}`,
            '1',
            'EX',
            SEEN_TTL_SECONDS,
            'NX',
          );
          if (fresh !== 'OK') continue;
          try {
            await app.redis.xadd(INBOUND_STREAM, '*', 'msg', JSON.stringify(msg));
          } catch (err) {
            // A message that never reached the stream must not block Meta's retry.
            await app.redis.del(`msg:seen:whatsapp:${msg.messageId}`).catch(() => {});
            throw err;
          }
        }
        return reply.code(200).send();
      },
    );
  });
}
