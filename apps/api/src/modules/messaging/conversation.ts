import type { FastifyInstance } from 'fastify';
import { createEngineDeps } from './deps.js';
import { handle } from './engine/engine.js';
import type { EngineDeps, InboundEvent, OutboundMessage } from './engine/types.js';
import { loadSession, saveSession } from './session-store.js';
import { traceNote } from './trace.js';

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
 * session. A photo can take up to RECOGNITION_BUDGET_MS (12 s) here (garment
 * recognition at the photo step), so the caller must not make other senders
 * wait behind it.
 */
export async function runConversation(
  app: FastifyInstance,
  account: ConversationAccount,
  event: InboundEvent,
  messageId: string,
  deps: EngineDeps = createEngineDeps(app),
): Promise<OutboundMessage[]> {
  const prev = await loadSession(app.redis, account.channel, account.externalId);
  const ctx = {
    userId: account.userId,
    accountId: account.id,
    messageId,
    // externalId is the wa_id the trace is keyed by.
    note:
      account.channel === 'whatsapp'
        ? (title: string, lines: string[]) => traceNote(app, account.externalId, title, lines)
        : undefined,
  };
  // A session left by the (unwired) try-on engine shares state names with this one,
  // so it is handed null rather than driven mid-step by the wrong reducer.
  const { session, messages } = await handle(
    prev?.flow === 'tryon' ? null : prev,
    event,
    ctx,
    deps,
  );
  await saveSession(app.redis, account.channel, account.externalId, session);
  return messages;
}
