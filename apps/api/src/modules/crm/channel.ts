import { type DB, schema } from '@aivastra/db';
import type { IdentifyBlocker } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import {
  createWhatsappClient,
  MetaApiError,
  type WhatsappClient,
} from '../messaging/channels/whatsapp/client.js';
import { openSecret } from './crypto.js';

// The merchant's own WhatsApp Business number (mode A, spec §4.1). Everything that talks to
// Meta for a merchant goes through `app.crmFetch`, so tests replace one function instead of
// the network.

declare module 'fastify' {
  interface FastifyInstance {
    /** fetch for Graph API calls made with merchant channel credentials (tests stub it). */
    crmFetch: typeof fetch;
  }
}

export type ChannelRow = typeof schema.merchantWhatsappChannels.$inferSelect;

export async function channelForMerchant(db: DB, merchantId: string): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(schema.merchantWhatsappChannels)
    .where(eq(schema.merchantWhatsappChannels.merchantId, merchantId))
    .limit(1);
  return row ?? null;
}

export async function channelByPhoneNumberId(
  db: DB,
  phoneNumberId: string,
): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(schema.merchantWhatsappChannels)
    .where(eq(schema.merchantWhatsappChannels.phoneNumberId, phoneNumberId))
    .limit(1);
  return row ?? null;
}

export function channelClient(app: FastifyInstance, row: ChannelRow): WhatsappClient {
  return createWhatsappClient({
    phoneNumberId: row.phoneNumberId,
    accessToken: openSecret(app.env.CRM_DATA_KEY, row.accessTokenEnc),
    graphVersion: app.env.WHATSAPP_GRAPH_VERSION,
    fetchImpl: app.crmFetch,
  });
}

/**
 * Proves the pasted credentials work before anything is stored: the token must be able to read
 * this phone number. Returns the number as Meta knows it (bare digits), which is what the
 * tablet's wa.me link uses, so a typo in a hand-typed display number cannot happen.
 */
export async function verifyChannelCredentials(
  app: FastifyInstance,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  const url = `https://graph.facebook.com/${app.env.WHATSAPP_GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number`;
  let res: Response;
  try {
    res = await app.crmFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new AppError('WHATSAPP_UNREACHABLE', 502, 'could not reach WhatsApp to check the number');
  }
  if (!res.ok) {
    // Never echo Meta's message: it can quote the token's app or business names.
    throw new AppError(
      'WHATSAPP_CREDENTIALS_REJECTED',
      422,
      'WhatsApp rejected these details: check the phone number id and the access token',
    );
  }
  const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string };
  const digits = (body.display_phone_number ?? '').replace(/\D/g, '');
  if (!digits) {
    throw new AppError(
      'WHATSAPP_CREDENTIALS_REJECTED',
      422,
      'WhatsApp returned no number for this id',
    );
  }
  return digits;
}

/** Why identification is off for this merchant, if it is (plan C2, C3). Empty = available. */
export async function identifyBlockers(
  app: FastifyInstance,
  merchantId: string,
): Promise<IdentifyBlocker[]> {
  const blockers: IdentifyBlocker[] = [];
  if (app.env.CRM_IDENTIFY_ENABLED !== true || !app.env.CRM_DATA_KEY) blockers.push('feature_off');
  if (!(await channelForMerchant(app.db, merchantId))) blockers.push('no_channel');
  const [settings] = await app.db
    .select()
    .from(schema.merchantCrmSettings)
    .where(eq(schema.merchantCrmSettings.merchantId, merchantId))
    .limit(1);
  if (!settings?.photoRetentionDays || !settings.profileRetentionDays)
    blockers.push('no_retention');
  return blockers;
}

export { MetaApiError };
