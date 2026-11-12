import type { FastifyInstance } from 'fastify';
import { parseWebhook, receivingPhoneNumberIds } from '../messaging/channels/whatsapp/parse.js';
import { verifySignature } from '../messaging/channels/whatsapp/signature.js';
import { channelByPhoneNumberId } from './channel.js';
import { openSecret } from './crypto.js';
import { CRM_INBOUND_STREAM } from './inbound.js';

const SEEN_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Plan C4 / spec §4.1 A3. Called by the shared WhatsApp webhook BEFORE its own checks. A body
 * addressed to a connected merchant number is verified with THAT merchant's app secret (their
 * own Meta app signs it) and queued on crm:inbound; anything else is 'not_mine' and takes the
 * existing seller path untouched. Routing reads the unverified body only to pick the secret;
 * nothing in it is acted on before the signature check passes.
 */
export async function routeMerchantWebhook(
  app: FastifyInstance,
  raw: Buffer,
  signature: string | undefined,
): Promise<'not_mine' | 'accepted' | 'rejected'> {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf-8'));
  } catch {
    return 'not_mine';
  }
  const ids = receivingPhoneNumberIds(body);
  if (ids.length !== 1) return 'not_mine';
  const channel = await channelByPhoneNumberId(app.db, ids[0]!);
  if (!channel) return 'not_mine';
  // Feature off: acknowledge so Meta stops retrying, act on nothing (plan C2).
  if (app.env.CRM_IDENTIFY_ENABLED !== true || !app.env.CRM_DATA_KEY) return 'accepted';
  const secret = openSecret(app.env.CRM_DATA_KEY, channel.appSecretEnc);
  if (!verifySignature(raw, signature, secret)) return 'rejected';

  for (const msg of parseWebhook(body)) {
    const fresh = await app.redis.set(
      `crm:seen:${msg.messageId}`,
      '1',
      'EX',
      SEEN_TTL_SECONDS,
      'NX',
    );
    if (fresh !== 'OK') continue;
    try {
      await app.redis.xadd(
        CRM_INBOUND_STREAM,
        '*',
        'merchantId',
        channel.merchantId,
        'msg',
        JSON.stringify(msg),
      );
    } catch (err) {
      await app.redis.del(`crm:seen:${msg.messageId}`).catch(() => {});
      throw err;
    }
  }
  return 'accepted';
}
