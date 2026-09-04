import { schema } from '@aivastra/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// Shared ticket-table side effects for the two REST intake surfaces
// (`/v1/support`, `/v1/contact`). apps/chatbot owns the canonical versions in
// `conversation/service.ts` — these mirror them for apps/api, which can't import
// across app boundaries. Keeping one copy per app is what stops the two REST
// routes drifting apart from each other, as they already did once.

/** Max length of a subject auto-derived from a ticket's first user message. */
export const SUBJECT_MAX_LEN = 80;

/**
 * Flip a RESOLVED ticket back to OPEN with the full set of side effects
 * `reopenIfResolved` performs in apps/chatbot: audit event, a `state_change`
 * frame so an open chat widget stops showing stale "Marked resolved" copy, and
 * a queue refresh so agents see the ticket return.
 */
export async function reopenResolvedTicket(app: FastifyInstance, convId: string): Promise<void> {
  const [row] = await app.db
    .update(schema.chatbotConversations)
    .set({ status: 'OPEN', assignedAgentId: null })
    .where(
      and(
        eq(schema.chatbotConversations.id, convId),
        eq(schema.chatbotConversations.status, 'RESOLVED'),
      ),
    )
    .returning();
  if (!row) return;
  await app.db.insert(schema.chatbotEvents).values({
    conversationId: convId,
    type: 'reopen',
    fromStatus: 'RESOLVED',
    toStatus: 'OPEN',
  });
  await app.redis.publish(
    `chatbot:conv:${convId}`,
    JSON.stringify({
      type: 'state_change',
      conversationId: convId,
      status: 'OPEN',
      reason: null,
    }),
  );
  await app.redis.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
}

/**
 * Derive the ticket's subject from its first user message. The `subject IS NULL`
 * guard is what makes this safe to call on every message without a read-then-write
 * race — later messages simply match no rows.
 */
export async function setSubjectFromFirstMessage(
  app: FastifyInstance,
  convId: string,
  content: string,
): Promise<void> {
  const subject = content.trim().slice(0, SUBJECT_MAX_LEN);
  if (!subject) return;
  await app.db
    .update(schema.chatbotConversations)
    .set({ subject })
    .where(
      and(eq(schema.chatbotConversations.id, convId), isNull(schema.chatbotConversations.subject)),
    );
}
