import { and, type DB, eq, inArray, isNull, schema, sql } from '@aivastra/db';
import { chatbotMessagesTotal } from '@aivastra/observability';
import type { ChatMessageT } from '@aivastra/types';
import { alias } from 'drizzle-orm/pg-core';
import type { Redis } from 'ioredis';

export type ConvStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  // legacy — never produced by current code; kept so escalation.ts and the
  // retired branches of sweeper.ts keep compiling without being touched.
  | 'BOT'
  | 'PENDING_HUMAN'
  | 'HUMAN';

export interface Conversation {
  id: string;
  userId: string;
  status: ConvStatus;
  assignedAgentId: string | null;
  escalationReason: string | null;
}

export function convChannel(convId: string): string {
  return `chatbot:conv:${convId}`;
}

export async function publishConv(pub: Redis, convId: string, frame: object): Promise<void> {
  await pub.publish(convChannel(convId), JSON.stringify(frame));
}

/**
 * `created` reports whether this call inserted the ticket rather than resuming one.
 * The WS connect handler needs it: a ticket opened purely from the chat bubble is
 * otherwise invisible to agents until some unrelated event refreshes their queue.
 */
export async function getOrCreateActiveConversation(
  db: DB,
  userId: string,
  source: string = 'chat_widget',
): Promise<Conversation & { created: boolean }> {
  const [existing] = await db
    .select()
    .from(schema.chatbotConversations)
    .where(
      and(
        eq(schema.chatbotConversations.userId, userId),
        sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
      ),
    );
  if (existing) return { ...(existing as Conversation), created: false };
  const [created] = await db
    .insert(schema.chatbotConversations)
    .values({ userId, source })
    .onConflictDoNothing()
    .returning();
  if (created) return { ...(created as Conversation), created: true };
  const [winner] = await db
    .select()
    .from(schema.chatbotConversations)
    .where(
      and(
        eq(schema.chatbotConversations.userId, userId),
        sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
      ),
    );
  return { ...(winner as Conversation), created: false };
}

/** Max length of a subject auto-derived from a ticket's first user message. */
export const SUBJECT_MAX_LEN = 80;

/**
 * Derive the ticket's subject from its first user message. The `subject IS NULL`
 * guard is what makes this safe to call on every message without a read-then-write
 * race — later messages simply match no rows.
 */
export async function setSubjectFromFirstMessage(
  db: DB,
  convId: string,
  content: string,
): Promise<void> {
  const subject = content.trim().slice(0, SUBJECT_MAX_LEN);
  if (!subject) return;
  await db
    .update(schema.chatbotConversations)
    .set({ subject })
    .where(
      and(eq(schema.chatbotConversations.id, convId), isNull(schema.chatbotConversations.subject)),
    );
}

function toWire(
  row: typeof schema.chatbotMessages.$inferSelect,
  senderName: string | null = null,
): ChatMessageT {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessageT['role'],
    senderId: row.senderId,
    senderName,
    content: row.content,
    attachmentKey: row.attachmentKey,
    attachmentType: row.attachmentType,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resolves one agent's display name for the customer-facing widget.
 * senderId on an 'agent' message is admin_users.id, which carries no name
 * itself — this chains through to the underlying users row exactly like
 * GET /admin/chatbot/conversations does for the admin-side inbox (see
 * apps/api/src/modules/admin/chatbot.routes.ts). Falls back to email so a
 * user with no displayName set still shows as a person, not a blank.
 */
async function resolveAgentName(db: DB, adminUserId: string): Promise<string | null> {
  const agentUser = alias(schema.users, 'agent_user');
  const [row] = await db
    .select({ name: agentUser.displayName, email: agentUser.email })
    .from(schema.adminUsers)
    .innerJoin(agentUser, eq(agentUser.id, schema.adminUsers.userId))
    .where(eq(schema.adminUsers.id, adminUserId));
  return row ? (row.name ?? row.email) : null;
}

/** Batched version of resolveAgentName for a page of messages. */
async function resolveAgentNames(
  db: DB,
  adminUserIds: string[],
): Promise<Map<string, string | null>> {
  if (adminUserIds.length === 0) return new Map();
  const agentUser = alias(schema.users, 'list_agent_user');
  const rows = await db
    .select({ id: schema.adminUsers.id, name: agentUser.displayName, email: agentUser.email })
    .from(schema.adminUsers)
    .innerJoin(agentUser, eq(agentUser.id, schema.adminUsers.userId))
    .where(inArray(schema.adminUsers.id, adminUserIds));
  return new Map(rows.map((r) => [r.id, r.name ?? r.email]));
}

export async function appendMessage(
  db: DB,
  pub: Redis,
  convId: string,
  msg: {
    role: 'user' | 'bot' | 'agent' | 'system';
    senderId?: string | null;
    content: string;
    meta?: { toolCalls?: string[]; qnaIds?: string[] } | null;
    attachmentKey?: string | null;
    attachmentType?: string | null;
  },
): Promise<ChatMessageT> {
  const [row] = await db
    .insert(schema.chatbotMessages)
    .values({
      conversationId: convId,
      role: msg.role,
      senderId: msg.senderId ?? null,
      content: msg.content,
      meta: msg.meta ?? null,
      attachmentKey: msg.attachmentKey ?? null,
      attachmentType: msg.attachmentType ?? null,
    })
    .returning();
  if (!row) throw new Error('appendMessage: insert returned no row');
  chatbotMessagesTotal.inc({ role: msg.role });
  await db
    .update(schema.chatbotConversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(schema.chatbotConversations.id, convId));
  const senderName =
    msg.role === 'agent' && msg.senderId ? await resolveAgentName(db, msg.senderId) : null;
  const wire = toWire(row, senderName);
  await publishConv(pub, convId, { type: 'message', message: wire });
  return wire;
}

export async function reopenIfResolved(db: DB, pub: Redis, convId: string): Promise<void> {
  const [row] = await db
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
  await db.insert(schema.chatbotEvents).values({
    conversationId: convId,
    type: 'reopen',
    fromStatus: 'RESOLVED',
    toStatus: 'OPEN',
  });
  await publishConv(pub, convId, {
    type: 'state_change',
    conversationId: convId,
    status: 'OPEN',
    reason: null,
  });
  await pub.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
}

export async function transition(
  db: DB,
  pub: Redis,
  convId: string,
  opts: {
    from: ConvStatus | ConvStatus[];
    to: ConvStatus;
    type: string;
    actorId?: string | null;
    reason?: string | null;
  },
): Promise<boolean> {
  const froms = Array.isArray(opts.from) ? opts.from : [opts.from];
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.chatbotConversations)
      .set({
        status: opts.to,
        ...(opts.to === 'CLOSED' ? { closedAt: new Date() } : {}),
        ...(opts.type === 'escalate' ? { escalationReason: opts.reason ?? null } : {}),
      })
      .where(
        and(
          eq(schema.chatbotConversations.id, convId),
          inArray(schema.chatbotConversations.status, froms),
        ),
      )
      .returning();
    if (!row) return null;
    await tx.insert(schema.chatbotEvents).values({
      conversationId: convId,
      type: opts.type,
      actorId: opts.actorId ?? null,
      fromStatus: froms.length === 1 ? froms[0] : null,
      toStatus: opts.to,
      reason: opts.reason ?? null,
    });
    return row;
  });
  if (!updated) return false;
  await publishConv(pub, convId, {
    type: 'state_change',
    conversationId: convId,
    status: opts.to,
    reason: opts.reason ?? null,
  });
  return true;
}

export async function listMessages(
  db: DB,
  convId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageT[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [eq(schema.chatbotMessages.conversationId, convId)];
  if (opts.before) conds.push(sql`${schema.chatbotMessages.createdAt} < ${new Date(opts.before)}`);
  const rows = await db
    .select()
    .from(schema.chatbotMessages)
    .where(and(...conds))
    .orderBy(sql`${schema.chatbotMessages.createdAt} DESC`)
    .limit(limit);
  const agentIds = [
    ...new Set(
      rows.filter((r) => r.role === 'agent' && r.senderId).map((r) => r.senderId as string),
    ),
  ];
  const nameById = await resolveAgentNames(db, agentIds);
  return rows
    .reverse()
    .map((row) =>
      toWire(
        row,
        row.role === 'agent' && row.senderId ? (nameById.get(row.senderId) ?? null) : null,
      ),
    );
}
