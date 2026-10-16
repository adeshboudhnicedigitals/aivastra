import type { FastifyInstance } from 'fastify';
import { createEngineDeps } from './deps.js';
import { handle } from './engine/engine.js';
import type { EngineDeps, InboundEvent, OutboundMessage } from './engine/types.js';
import { loadSession, saveSession } from './session-store.js';

export interface ConversationAccount {
  id: string;
  userId: string;
  channel: string;
  externalId: string;
}

/**
 * One inbound event for one connected account: load the session, run the
 * engine, save, return what to send. The caller (plan 3's inbound consumer)
 * renders and sends the messages, and must process one sender's events one at
 * a time — two concurrent calls for one sender would overwrite each other's
 * session. A gender tap can take up to 8 s here (garment recognition, D48), so
 * the caller must not make other senders wait behind it.
 */
export async function runConversation(
  app: FastifyInstance,
  account: ConversationAccount,
  event: InboundEvent,
  messageId: string,
  deps: EngineDeps = createEngineDeps(app),
): Promise<OutboundMessage[]> {
  const prev = await loadSession(app.redis, account.channel, account.externalId);
  const { session, messages } = await handle(
    prev,
    event,
    { userId: account.userId, accountId: account.id, messageId },
    deps,
  );
  await saveSession(app.redis, account.channel, account.externalId, session);
  return messages;
}
