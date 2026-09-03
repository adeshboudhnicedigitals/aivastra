import { and, type DB, eq, inArray, schema, sql } from '@aivastra/db';
import { chatbotMessagesTotal } from '@aivastra/observability';
import type { ChatMessageT } from '@aivastra/types';
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

export async function getOrCreateActiveConversation(
  db: DB,
  userId: string,
  source: string = 'chat_widget',
): Promise<Conversation> {
  const [existing] = await db
    .select()
    .from(schema.chatbotConversations)
    .where(
      and(
        eq(schema.chatbotConversations.userId, userId),
        sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
      ),
    );
  if (existing) return existing as Conversation;
  const [created] = await db
    .insert(schema.chatbotConversations)
    .values({ userId, source })
    .onConflictDoNothing()
    .returning();
  if (created) return created as Conversation;
  const [winner] = await db
    .select()
    .from(schema.chatbotConversations)
    .where(
      and(
        eq(schema.chatbotConversations.userId, userId),
        sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
      ),
    );
  return winner as Conversation;
}

function toWire(row: typeof schema.chatbotMessages.$inferSelect): ChatMessageT {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessageT['role'],
    senderId: row.senderId,
    content: row.content,
    attachmentKey: row.attachmentKey,
    attachmentType: row.attachmentType,
    createdAt: row.createdAt.toISOString(),
  };
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
  const wire = toWire(row);
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
  return rows.reverse().map(toWire);
}
