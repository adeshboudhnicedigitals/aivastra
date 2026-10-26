import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { WhatsappClient } from './channels/whatsapp/client.js';
import type { ParsedInbound } from './channels/whatsapp/parse.js';
import { runConversation } from './conversation.js';
import { COPY } from './engine/copy.js';
import type { InboundEvent, OutboundMessage } from './engine/types.js';
import {
  CHANNEL_WHATSAPP,
  chatConnectUrl,
  connectAccount,
  consumeWebConnectCode,
  createChatConnectToken,
  findAccountByExternalId,
  type MessagingAccountRow,
  matchesProfilePhone,
  parseConnectCommand,
  toE164FromWaId,
} from './identity.js';
import { storeGarmentPhoto } from './photos.js';
import { sendMessages } from './send.js';

const M = schema.messagingAccounts;
// T6: generous for a person tapping through a wizard, low enough that one number
// cannot flood job creation or Meta sends.
const RATE_LIMIT_PER_MINUTE = 30;
// Same ceiling as Meta's own image limit; createJob applies the admin-set web limit.
const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

export type DeliverPending = (
  app: FastifyInstance,
  wa: WhatsappClient,
  accountId: string,
) => Promise<void>;

async function overRateLimit(app: FastifyInstance, externalId: string): Promise<boolean> {
  const key = `msg:rate:whatsapp:${externalId}`;
  const n = await app.redis.incr(key);
  if (n === 1) await app.redis.expire(key, 60);
  return n > RATE_LIMIT_PER_MINUTE;
}

async function downloadPhoto(
  app: FastifyInstance,
  wa: WhatsappClient,
  userId: string,
  mediaId: string,
  mimeType: string,
): Promise<InboundEvent | 'failed'> {
  if (!PHOTO_TYPES.has(mimeType)) return { type: 'unsupportedMedia' };
  // Spec section 13: two retries, then ask the seller to send it again.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const media = await wa.downloadMedia(mediaId, MAX_PHOTO_BYTES);
      if (!PHOTO_TYPES.has(media.mimeType)) return { type: 'unsupportedMedia' };
      return {
        type: 'image',
        garmentKey: await storeGarmentPhoto(app, userId, media.bytes, media.mimeType),
      };
    } catch (err) {
      app.log.warn({ err, attempt }, 'whatsapp photo download failed');
    }
  }
  return 'failed';
}

/** An unknown number: redeem a CONNECT code, or send a connect link. Never reaches the engine. */
async function handleUnknown(
  app: FastifyInstance,
  wa: WhatsappClient,
  m: ParsedInbound,
  externalId: string,
) {
  const code = m.content.kind === 'text' ? parseConnectCommand(m.content.text) : null;
  if (!code) {
    const token = await createChatConnectToken(app.redis, externalId);
    return sendMessages(app, wa, m.from, [
      {
        kind: 'link',
        text: COPY.connectPrompt,
        label: COPY.btnConnect,
        footer: COPY.connectFooter,
        url: chatConnectUrl(app.env.WEB_URL, token),
      },
    ]);
  }
  const hit = await consumeWebConnectCode(app.redis, code);
  if (!hit) return sendMessages(app, wa, m.from, [text(COPY.connectCodeInvalid)]);
  let account: MessagingAccountRow;
  try {
    ({ account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId,
      userId: hit.userId,
      linkedVia: 'web_code',
    }));
  } catch (err) {
    if (err instanceof AppError && err.code === 'NUMBER_IN_USE') {
      return sendMessages(app, wa, m.from, [text(COPY.numberInUse)]);
    }
    throw err;
  }
  await touchInbound(app, account.id);
  const [user] = await app.db
    .select({ phone: schema.users.phone })
    .from(schema.users)
    .where(eq(schema.users.id, hit.userId));
  const intro: OutboundMessage[] = [text(COPY.connected)];
  // D29: a hint, never a block.
  if (user?.phone && !matchesProfilePhone(externalId, user.phone)) {
    intro.push(text(COPY.connectedDifferentNumber(user.phone.slice(-4))));
  }
  const menu = await runConversation(
    app,
    convAccount(account),
    { type: 'text', text: 'menu' },
    m.messageId,
  );
  return sendMessages(app, wa, m.from, [...intro, ...menu]);
}

function convAccount(a: MessagingAccountRow) {
  return { id: a.id, userId: a.userId, channel: a.channel, externalId: a.externalId };
}

async function touchInbound(app: FastifyInstance, accountId: string) {
  const now = new Date();
  await app.db.update(M).set({ lastInboundAt: now, updatedAt: now }).where(eq(M.id, accountId));
}

/**
 * One message from Meta, end to end. The caller holds the per-sender lock, so
 * a sender's messages are handled strictly in order.
 */
export async function processInbound(
  app: FastifyInstance,
  wa: WhatsappClient,
  m: ParsedInbound,
  deliverPending: DeliverPending,
): Promise<void> {
  const externalId = toE164FromWaId(m.from);
  if (await overRateLimit(app, externalId)) {
    app.log.warn({ messageId: m.messageId }, 'whatsapp sender over rate limit — dropped');
    return;
  }

  const account = await findAccountByExternalId(app.db, CHANNEL_WHATSAPP, externalId);
  if (!account) return handleUnknown(app, wa, m, externalId);

  await touchInbound(app, account.id);
  const words = m.content.kind === 'text' ? m.content.text.trim().toLowerCase() : '';

  if (words === 'stop') {
    await app.db
      .update(M)
      .set({ optedOutAt: new Date(), updatedAt: new Date() })
      .where(eq(M.id, account.id));
    return sendMessages(app, wa, m.from, [text(COPY.stopped)]);
  }
  // D21: START, or any new message after a STOP, turns the bot back on — the
  // seller messaging us is what makes replying acceptable.
  if (account.optedOutAt) {
    await app.db
      .update(M)
      .set({ optedOutAt: null, updatedAt: new Date() })
      .where(eq(M.id, account.id));
  }
  // A connect code from an already-connected number is not special: it falls
  // through as ordinary text, which shows the current step again.

  // Results that finished while the window was closed go out first (D26).
  await deliverPending(app, wa, account.id);
  if (m.content.kind === 'templateButton') return;

  let event: InboundEvent;
  switch (m.content.kind) {
    case 'text':
      event =
        words === 'start' ? { type: 'text', text: 'menu' } : { type: 'text', text: m.content.text };
      break;
    case 'reply':
      event = { type: 'reply', id: m.content.id };
      break;
    case 'image': {
      const got = await downloadPhoto(
        app,
        wa,
        account.userId,
        m.content.mediaId,
        m.content.mimeType,
      );
      if (got === 'failed') return sendMessages(app, wa, m.from, [text(COPY.photoFailed)]);
      event = got;
      break;
    }
    default:
      event = { type: 'unsupportedMedia' };
  }

  const out = await runConversation(app, convAccount(account), event, m.messageId);
  await sendMessages(app, wa, m.from, out);
}
