import { schema } from '@aivastra/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordEvent } from '../analytics/record.js';
import type { WhatsappClient } from '../messaging/channels/whatsapp/client.js';
import type { ParsedInbound } from '../messaging/channels/whatsapp/parse.js';
import type { ChannelRow } from './channel.js';
import { encryptPhone, phoneHash } from './crypto.js';
import { takeIdentifyCode, verifiedKey } from './identify.js';

// CRM phase 2, Task 5: a shopper's messages to a BRAND's own number (mode A). Never the seller
// conversation engine (plan C4). Everything sent here is a free-form message inside the 24-hour
// window the shopper opened by writing first, so no template is involved (decision A1).

export const CRM_INBOUND_STREAM = 'crm:inbound';
/** Plan C5: replaced by the legally reviewed wording, keeping history by version. */
export const CONSENT_VERSION = 'v0-draft';
const LOOKS_RE = /^\s*looks\s+([a-z0-9]{6,12})\s*$/i;
const BTN_LOOKS_ONLY = 'crm_consent:looks';
const BTN_LOOKS_AND_OFFERS = 'crm_consent:both';
const CONTEXT_TTL_SECONDS = 24 * 60 * 60;
const MAX_LOOKS = 10;
const SENDER_LIMIT_PER_MIN = 20;

const contextKey = (merchantId: string, from: string) => `crm:ctx:${merchantId}:${from}`;

const text = (body: string) => ({ type: 'text', text: { body } });

async function overLimit(app: FastifyInstance, merchantId: string, from: string) {
  const key = `crm:rl:${merchantId}:${from}`;
  const n = await app.redis.incr(key);
  if (n === 1) await app.redis.expire(key, 60);
  return n > SENDER_LIMIT_PER_MIN;
}

/** The merchant's live shopper for this number, created on first contact. */
async function upsertShopper(app: FastifyInstance, merchantId: string, m: ParsedInbound) {
  const hash = phoneHash(app.env.CRM_DATA_KEY, m.from);
  const now = new Date();
  const [existing] = await app.db
    .select({ id: schema.shoppers.id })
    .from(schema.shoppers)
    .where(
      and(
        eq(schema.shoppers.merchantId, merchantId),
        eq(schema.shoppers.phoneHash, hash),
        isNull(schema.shoppers.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    await app.db
      .update(schema.shoppers)
      .set({ lastSeenAt: now })
      .where(eq(schema.shoppers.id, existing.id));
    return { id: existing.id, isNew: false };
  }
  const [row] = await app.db
    .insert(schema.shoppers)
    .values({
      merchantId,
      phoneHash: hash,
      phoneEnc: encryptPhone(app.env.CRM_DATA_KEY, m.from),
      displayName: m.profileName,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    // Two LOOKS messages from one number at once: the second finds the first's row.
    .onConflictDoNothing()
    .returning({ id: schema.shoppers.id });
  if (row) return { id: row.id, isNew: true };
  return upsertShopper(app, merchantId, m);
}

async function sessionDims(app: FastifyInstance, sessionId: string) {
  const [s] = await app.db
    .select()
    .from(schema.instoreSessions)
    .where(eq(schema.instoreSessions.id, sessionId))
    .limit(1);
  return s ?? null;
}

/** Sends this session's finished looks as image messages; returns how many went out. */
export async function sendLooks(
  app: FastifyInstance,
  wa: WhatsappClient,
  to: string,
  sessionId: string,
): Promise<number> {
  const done = await app.db
    .select({ resultKey: schema.jobOutputs.resultKey })
    .from(schema.jobs)
    .innerJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
    .where(and(eq(schema.jobs.sessionId, sessionId), eq(schema.jobs.status, 'COMPLETED')))
    .orderBy(desc(schema.jobs.completedAt))
    .limit(MAX_LOOKS);
  let sent = 0;
  for (const { resultKey } of done) {
    if (!resultKey) continue;
    const { url } = await app.storage.presignGet(resultKey, 24 * 3600);
    await wa.send(to, { type: 'image', image: { link: url } });
    sent++;
  }
  return sent;
}

/**
 * One inbound message to a merchant channel. `wa` sends from that merchant's number. Errors
 * propagate to the consumer, which logs and acks (a shopper message is not retried forever).
 */
export async function processCrmInbound(
  app: FastifyInstance,
  wa: WhatsappClient,
  channel: ChannelRow,
  m: ParsedInbound,
): Promise<void> {
  const merchantId = channel.merchantId;
  if (await overLimit(app, merchantId, m.from)) {
    app.log.warn({ merchantId }, 'crm inbound: sender over rate limit, dropped');
    return;
  }
  const words = m.content.kind === 'text' ? m.content.text.trim() : '';

  // ── LOOKS <code>: the tablet's QR ───────────────────────────────────────
  const looks = LOOKS_RE.exec(words);
  if (looks) {
    const ticket = await takeIdentifyCode(app, looks[1]!);
    // A code minted for another brand cannot be redeemed through this one's number.
    if (!ticket || ticket.merchantId !== merchantId) {
      await wa.send(m.from, text('This code has expired. Ask the store to show the QR again.'));
      return;
    }
    const shopper = await upsertShopper(app, merchantId, m);
    const s = await sessionDims(app, ticket.sessionId);
    if (!s) return;
    await app.db.transaction(async (tx) => {
      await tx
        .update(schema.instoreSessions)
        .set({ shopperId: shopper.id })
        .where(eq(schema.instoreSessions.id, s.id));
      await recordEvent(tx, {
        event: 'shopper_identified',
        merchantId,
        branchId: s.branchId,
        deviceId: s.deviceId,
        staffId: s.staffId,
        sessionId: s.id,
        shopperId: shopper.id,
        channel: s.mode,
        props: { returning: !shopper.isNew },
      });
    });
    await app.redis.set(verifiedKey(s.id), '1', 'EX', 3600);
    await app.redis.set(contextKey(merchantId, m.from), s.id, 'EX', CONTEXT_TTL_SECONDS);
    // Two consents, never bundled (spec §3): looks is what they asked for; offers is a
    // separate, optional choice, never preselected.
    await wa.send(m.from, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: 'Thanks! We will send the looks you tried on to this WhatsApp number. Would you also like to receive offers from us? You can reply STOP any time.',
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: BTN_LOOKS_ONLY, title: 'Just my looks' } },
            { type: 'reply', reply: { id: BTN_LOOKS_AND_OFFERS, title: 'Looks + offers' } },
          ],
        },
      },
    });
    return;
  }

  // ── Consent answer ──────────────────────────────────────────────────────
  if (
    m.content.kind === 'reply' &&
    (m.content.id === BTN_LOOKS_ONLY || m.content.id === BTN_LOOKS_AND_OFFERS)
  ) {
    const sessionId = await app.redis.get(contextKey(merchantId, m.from));
    const s = sessionId ? await sessionDims(app, sessionId) : null;
    if (!s || !s.shopperId) {
      await wa.send(m.from, text('This request has expired. Ask the store to show the QR again.'));
      return;
    }
    const marketing = m.content.id === BTN_LOOKS_AND_OFFERS;
    await app.db.transaction(async (tx) => {
      await tx.insert(schema.shopperConsents).values([
        {
          shopperId: s.shopperId!,
          merchantId,
          kind: 'looks',
          granted: true,
          version: CONSENT_VERSION,
          source: 'whatsapp_button',
        },
        {
          shopperId: s.shopperId!,
          merchantId,
          kind: 'marketing',
          granted: marketing,
          version: CONSENT_VERSION,
          source: 'whatsapp_button',
        },
      ]);
      await recordEvent(tx, {
        event: 'consent_recorded',
        merchantId,
        branchId: s.branchId,
        deviceId: s.deviceId,
        staffId: s.staffId,
        sessionId: s.id,
        shopperId: s.shopperId,
        channel: s.mode,
        props: { looks: true, marketing, version: CONSENT_VERSION },
      });
    });
    await deliver(app, wa, m.from, s);
    return;
  }

  // ── SEND: looks that were still generating at consent time ──────────────
  if (/^send$/i.test(words)) {
    const sessionId = await app.redis.get(contextKey(merchantId, m.from));
    const s = sessionId ? await sessionDims(app, sessionId) : null;
    if (s?.shopperId) return deliver(app, wa, m.from, s);
  }

  // ── STOP: marketing withdrawn immediately (spec §3) ─────────────────────
  if (/^stop$/i.test(words)) {
    const hash = phoneHash(app.env.CRM_DATA_KEY, m.from);
    const [shopper] = await app.db
      .select({ id: schema.shoppers.id })
      .from(schema.shoppers)
      .where(
        and(
          eq(schema.shoppers.merchantId, merchantId),
          eq(schema.shoppers.phoneHash, hash),
          isNull(schema.shoppers.deletedAt),
        ),
      )
      .limit(1);
    if (shopper) {
      await app.db.insert(schema.shopperConsents).values({
        shopperId: shopper.id,
        merchantId,
        kind: 'marketing',
        granted: false,
        version: CONSENT_VERSION,
        source: 'whatsapp_stop',
      });
    }
    await wa.send(m.from, text('Done. You will not receive offers from us any more.'));
    return;
  }

  await wa.send(
    m.from,
    text('To get your try-on looks, scan the QR on the store tablet. Reply STOP to stop offers.'),
  );
}

async function deliver(
  app: FastifyInstance,
  wa: WhatsappClient,
  to: string,
  s: NonNullable<Awaited<ReturnType<typeof sessionDims>>>,
) {
  const sent = await sendLooks(app, wa, to, s.id);
  if (sent === 0) {
    await wa.send(
      to,
      text('Your looks are still being created. Reply SEND in a minute to get them.'),
    );
    return;
  }
  await recordEvent(app.db, {
    event: 'looks_sent',
    merchantId: s.merchantId,
    branchId: s.branchId,
    deviceId: s.deviceId,
    staffId: s.staffId,
    sessionId: s.id,
    shopperId: s.shopperId,
    channel: s.mode,
    props: { count: sent },
  });
}
