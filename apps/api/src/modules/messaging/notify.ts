import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { runConversation } from './conversation.js';
import { COPY } from './engine/copy.js';
import type { InboundEvent, OutboundMessage } from './engine/types.js';
import { createAppWhatsappClient } from './inbound-consumer.js';
import { sendMessages, windowOpen } from './send.js';

const M = schema.messagingAccounts;

/** Best-effort pushes into a chat. A failure here must never fail the caller's request. */
async function push(
  app: FastifyInstance,
  accountId: string,
  build: (a: typeof M.$inferSelect) => Promise<OutboundMessage[]>,
) {
  try {
    if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return;
    const wa = createAppWhatsappClient(app);
    const [a] = await app.db.select().from(M).where(eq(M.id, accountId));
    // Only inside the window and never after STOP: these are free-form messages.
    if (!wa || !a || a.optedOutAt || !windowOpen(a.lastInboundAt)) return;
    await sendMessages(app, wa, a.externalId.slice(1), await build(a));
  } catch (err) {
    app.log.error({ err, accountId }, 'whatsapp push failed');
  }
}

const conv = (a: typeof M.$inferSelect) => ({
  id: a.id,
  userId: a.userId,
  channel: a.channel,
  externalId: a.externalId,
});

/** Chat-started connect confirmed on the web: "Connected" + the menu. */
export function notifyConnected(app: FastifyInstance, accountId: string) {
  return push(app, accountId, async (a) => [
    { kind: 'text', text: COPY.connected },
    ...(await runConversation(app, conv(a), { type: 'text', text: 'menu' }, `connected:${a.id}`)),
  ]);
}

/** A purchase completed on the web: tell every connected chat, and resume a NO_CREDITS wizard. */
export async function notifyCreditsAdded(app: FastifyInstance, userId: string, credits: number) {
  if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return;
  const accounts = await app.db.select({ id: M.id }).from(M).where(eq(M.userId, userId));
  const event: InboundEvent = { type: 'creditsAdded', credits };
  for (const { id } of accounts) {
    await push(app, id, (a) => runConversation(app, conv(a), event, `credits:${Date.now()}`));
  }
}
