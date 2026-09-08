# Chatbot Ticket System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the LLM agent from `apps/chatbot`'s answering path and turn the human-in-the-loop side into a ticket system: every user message, from any of three entry points (chat bubble, Contact Us page, navbar Support modal), becomes/continues one ticket per user that a human agent claims and works from a queue.

**Architecture:** `chatbot_conversations` (kept as the table name — a row is a ticket) drops its `BOT` status; new tickets start `OPEN` and skip straight to the human queue. `apps/chatbot` keeps owning the chat bubble's live WebSocket path. `apps/api`'s existing `/v1/contact` and `/v1/support` routes are rewritten in place to write directly into the ticket tables and publish over the same Redis channels `apps/chatbot` already uses — following the precedent already set by `apps/api`'s admin claim/takeover/end routes, which do exactly this today.

**Tech Stack:** Fastify 5, Drizzle ORM / PostgreSQL, Redis pub/sub, `ws` WebSockets, Zod, React (Next.js `apps/catalogues-web`, Vite `apps/admin-web`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-chatbot-detach-agent-ticket-system-design.md`

## Global Constraints

- **Hide, don't delete.** Code that becomes unused (the LLM agent module `apps/chatbot/src/agent/*`, `conversation/escalation.ts`'s availability-gated email fallback, the retired `BOT`/`PENDING_HUMAN`/`HUMAN` status branches in `conversation/sweeper.ts`) is unwired — call sites/route registrations removed — not deleted. Files and their contents stay on disk. The one exception: unit tests asserting now-nonexistent behavior (bot-turn/fallback tests) are deleted outright, because keeping them would assert something false.
- **One active ticket per user.** No ticket-list UI, no concurrent tickets — this constraint is unchanged from today's `chatbot_conversations_one_active_idx`.
- **No production schema/data work.** All migration work here runs locally against `pnpm docker:up`, then ships through push → CI/CD → `db:migrate:prod`. Never ad hoc against prod.
- **`chatbot_qna`/`chatbot_embeddings`/ingest pipeline/`ChatbotQnaPage` stay untouched** — unused by the ticket system, kept for possible future agent-assist reuse.
- **Status literal widening, not narrowing.** `ConvStatus` (chatbot's `conversation/service.ts`) and `ConversationStatus` (`packages/types/src/chatbot.ts`) keep `BOT`/`PENDING_HUMAN`/`HUMAN` as legal-but-never-produced values alongside the new `OPEN`/`IN_PROGRESS`/`RESOLVED`/`CLOSED`. This is what lets `escalation.ts` and the dead branches of `sweeper.ts` keep compiling untouched — true hiding — while every live code path (orchestrator, gateway, admin routes, both rewritten `/v1/*` routes, both frontends) only ever produces the new four values.

---

## File Structure

**Modified:**
- `packages/db/src/schema/chatbot.ts` — new columns, new status default
- `packages/db/src/migrations/0190_<generated>.sql` — generated + hand-edited for data backfill
- `packages/types/src/chatbot.ts` — widened status enum, attachment fields
- `apps/chatbot/src/conversation/service.ts` — ticket creation with `source`, attachment passthrough, reopen-on-message-to-RESOLVED
- `apps/chatbot/src/conversation/orchestrator.ts` — bot turn removed
- `apps/chatbot/src/conversation/sweeper.ts` — agent-disconnect recovery ported to new status names
- `apps/chatbot/src/ws/gateway.ts` — attachment passthrough, `escalate` branch unwired, `IN_PROGRESS` check
- `apps/api/src/modules/admin/chatbot.routes.ts` — status renames, new `resolve` route, new ticket-fields PATCH route
- `apps/api/src/modules/support/routes.ts` — `/v1/support` rewritten to write tickets
- `apps/api/src/modules/jobs/routes.ts` — `/v1/contact` rewritten to write tickets
- `apps/catalogues-web/src/components/chat-widget.tsx` — status renames, attachment upload UI, dead "Talk to a human" branch removed
- `apps/catalogues-web/src/app/(app)/contact-us/page.tsx` — success copy
- `apps/catalogues-web/src/components/SupportModal.tsx` — success copy
- `apps/admin-web/src/pages/ChatInboxPage.tsx` — two-column queue, subject/category/priority, resolve/close, attachment rendering
- `apps/admin-web/src/pages/ContactRequestsPage.tsx` — legacy banner
- `apps/admin-web/src/components/Sidebar.tsx` — nav label
- `apps/chatbot/test/conversation.test.ts`, `apps/chatbot/test/ws.test.ts`, `apps/chatbot/test/ratelimit.test.ts` — status literal updates

**Deleted:**
- `apps/chatbot/test/bot.test.ts` — asserts bot-turn behavior that no longer exists
- `apps/chatbot/test/escalation.test.ts` — asserts availability-gated escalation/email-fallback behavior that no longer runs

**Untouched (hidden, not deleted):**
- `apps/chatbot/src/agent/bot.ts`, `agent/tools.ts`, `agent/models.ts`, `agent/search.ts`
- `apps/chatbot/src/conversation/escalation.ts`
- `apps/chatbot/src/routes/ingest.ts`, `apps/admin-web/src/pages/ChatbotQnaPage.tsx`

---

### Task 1: Schema — ticket fields, attachment fields, status default

**Files:**
- Modify: `packages/db/src/schema/chatbot.ts:51-89`
- Create: `packages/db/src/migrations/0190_<generated>.sql` (filename assigned by `drizzle-kit generate`)
- Test: `apps/chatbot/test/conversation.test.ts` (Task 13 updates its assertions; this task just needs the schema to load and migrations to apply cleanly)

**Interfaces:**
- Produces: `schema.chatbotConversations` gains `source: text`, `category: text | null`, `priority: text` (default `'normal'`), `subject: text | null`. `schema.chatbotMessages` gains `attachmentKey: text | null`, `attachmentType: text | null`. `chatbotConversations.status` default changes from `'BOT'` to `'OPEN'`.

- [ ] **Step 1: Edit the schema**

In `packages/db/src/schema/chatbot.ts`, change the `chatbotConversations` table definition:

```typescript
export const chatbotConversations = pgTable(
  'chatbot_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('OPEN'),
    source: text('source').notNull().default('chat_widget'),
    category: text('category'),
    priority: text('priority').notNull().default('normal'),
    subject: text('subject'),
    assignedAgentId: uuid('assigned_agent_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    escalationReason: text('escalation_reason'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('chatbot_conversations_one_active_idx')
      .on(t.userId)
      .where(sql`${t.status} <> 'CLOSED'`),
    index('chatbot_conversations_status_idx').on(t.status, t.lastMessageAt),
  ],
);
```

(`escalationReason` stays — it's not removed, only unused by new code going forward; the spec's "drop the column" language is superseded by the "hide, don't delete" constraint set during planning. Leaving it costs nothing and avoids touching `escalation.ts`'s writes to it.)

And `chatbotMessages`:

```typescript
export const chatbotMessages = pgTable(
  'chatbot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatbotConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    senderId: uuid('sender_id'),
    content: text('content').notNull(),
    attachmentKey: text('attachment_key'),
    attachmentType: text('attachment_type'),
    meta: jsonb('meta').$type<{ toolCalls?: string[]; qnaIds?: string[] }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chatbot_messages_conv_idx').on(t.conversationId, t.createdAt)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`

This produces a new file `packages/db/src/migrations/0190_<random-name>.sql` with `ALTER TABLE` statements for the new columns and the changed default. Note the actual filename it picks.

- [ ] **Step 3: Hand-edit the generated migration to add the status backfill**

Open the generated `0190_<random-name>.sql` and append (after the `ALTER TABLE` statements drizzle-kit wrote):

```sql
UPDATE "chatbot_conversations" SET "status" = 'OPEN' WHERE "status" IN ('BOT', 'PENDING_HUMAN');
UPDATE "chatbot_conversations" SET "status" = 'IN_PROGRESS' WHERE "status" = 'HUMAN';
UPDATE "chatbot_conversations" SET "source" = 'chat_widget' WHERE "source" IS NULL;
```

(The third line only matters if `drizzle-kit` generates the new `source` column without a default fill for existing rows — the column definition already has `.default('chat_widget')`, so this is a safety net, not strictly required, but cheap and explicit.)

- [ ] **Step 4: Apply and verify locally**

Run: `pnpm docker:up` (if not already running), then `pnpm db:migrate`

Expected: migration applies with no errors. Verify with:

```bash
psql "$DATABASE_URL" -c "SELECT status, count(*) FROM chatbot_conversations GROUP BY status;"
```

Expected: no rows with `status` in `('BOT', 'PENDING_HUMAN', 'HUMAN')`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/chatbot.ts packages/db/src/migrations/
git commit -m "feat(db): add ticket fields to chatbot_conversations/messages, remap statuses"
```

---

### Task 2: Shared types — widened status enum, attachment fields

**Files:**
- Modify: `packages/types/src/chatbot.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConversationStatus` now parses `'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'BOT' | 'PENDING_HUMAN' | 'HUMAN'`. `ChatMessage`/`ChatMessageT` gain `attachmentKey: string | null`, `attachmentType: string | null`. `WsClientFrame`'s `message` variant gains optional `attachmentKey`.

- [ ] **Step 1: Edit the type module**

```typescript
export const ConversationStatus = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  // legacy values — never produced by current code, kept so already-hidden
  // dead code in apps/chatbot (conversation/escalation.ts, retired branches
  // of conversation/sweeper.ts) keeps compiling without being touched.
  'BOT',
  'PENDING_HUMAN',
  'HUMAN',
]);
export type ConversationStatusT = z.infer<typeof ConversationStatus>;

export const ChatRole = z.enum(['user', 'bot', 'agent', 'system']);

export const ChatMessage = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: ChatRole,
  senderId: z.string().uuid().nullable(),
  content: z.string(),
  attachmentKey: z.string().nullable(),
  attachmentType: z.string().nullable(),
  createdAt: z.string(), // ISO
});
export type ChatMessageT = z.infer<typeof ChatMessage>;

// frames a USER socket may send
export const WsClientFrame = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    content: z.string().min(1).max(2000),
    attachmentKey: z.string().optional(),
  }),
  z.object({ type: z.literal('typing') }),
  z.object({ type: z.literal('escalate') }),
]);
export type WsClientFrameT = z.infer<typeof WsClientFrame>;
```

Leave `WsAgentFrame`, `WsServerFrame`, and `QnaUpsert` as they are — `WsServerFrame`'s `message` variant already embeds the full `ChatMessage` (which now carries the attachment fields), so no separate edit is needed there.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @aivastra/types typecheck`

Expected: passes with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/chatbot.ts
git commit -m "feat(types): widen ConversationStatus, add attachment fields to chat messages"
```

---

### Task 3: `apps/chatbot` conversation service — ticket creation with source, attachment passthrough

**Files:**
- Modify: `apps/chatbot/src/conversation/service.ts`
- Test: `apps/chatbot/test/conversation.test.ts` (rewritten in Task 13, after this task lands — this task's own steps below add the two new assertions this task needs directly)

**Interfaces:**
- Consumes: `schema.chatbotConversations` / `schema.chatbotMessages` columns from Task 1.
- Produces: `getOrCreateActiveConversation(db, userId, source?)` — `source` defaults to `'chat_widget'`, only used on insert (ignored when an active row already exists). New tickets get a derived `subject` from... no — subject derivation happens where the first message is known (callers), not inside `getOrCreateActiveConversation`, which runs before any message exists. `appendMessage(db, pub, convId, msg)` — `msg` gains optional `attachmentKey`/`attachmentType`. New exported `reopenIfResolved(db, pub, convId)` — call before appending a message; if the ticket is `RESOLVED`, flips it to `OPEN` and clears `assignedAgentId`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/chatbot/test/conversation.test.ts` (inside the existing `describe('conversation service', ...)` block, after the existing tests):

```typescript
  it('getOrCreateActiveConversation defaults to OPEN with chat_widget source', async () => {
    const [freshUser] = await t.deps.db
      .insert(schema.users)
      .values({ email: `src-${crypto.randomUUID()}@test.dev`, passwordHash: 'x', emailVerified: true })
      .returning();
    const conv = await getOrCreateActiveConversation(t.deps.db, freshUser.id);
    expect(conv.status).toBe('OPEN');
  });

  it('getOrCreateActiveConversation honors an explicit source on creation', async () => {
    const [freshUser] = await t.deps.db
      .insert(schema.users)
      .values({ email: `src2-${crypto.randomUUID()}@test.dev`, passwordHash: 'x', emailVerified: true })
      .returning();
    const conv = await getOrCreateActiveConversation(t.deps.db, freshUser.id, 'contact_us');
    const [row] = await t.deps.db
      .select({ source: schema.chatbotConversations.source })
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.source).toBe('contact_us');
  });

  it('appendMessage persists an attachment', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    const msg = await appendMessage(t.deps.db, t.deps.pub, conv.id, {
      role: 'user',
      senderId: userId,
      content: 'see attached',
      attachmentKey: 'support/abc.jpg',
      attachmentType: 'image/jpeg',
    });
    expect(msg.attachmentKey).toBe('support/abc.jpg');
    const [stored] = await t.deps.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.id, msg.id));
    expect(stored?.attachmentType).toBe('image/jpeg');
  });

  it('reopenIfResolved flips RESOLVED back to OPEN and clears the agent', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await t.deps.db
      .update(schema.chatbotConversations)
      .set({ status: 'RESOLVED', assignedAgentId: null })
      .where(eq(schema.chatbotConversations.id, conv.id));
    await reopenIfResolved(t.deps.db, t.deps.pub, conv.id);
    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('OPEN');
    expect(row?.assignedAgentId).toBeNull();
  });

  it('reopenIfResolved is a no-op when not RESOLVED', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await reopenIfResolved(t.deps.db, t.deps.pub, conv.id);
    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('OPEN');
  });
```

Add `reopenIfResolved` and `eq` (already imported) to the test file's import line:

```typescript
import {
  appendMessage,
  getOrCreateActiveConversation,
  listMessages,
  reopenIfResolved,
  transition,
} from '../src/conversation/service.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts test/conversation.test.ts` (from `apps/chatbot`)

Expected: FAIL — `getOrCreateActiveConversation` doesn't accept a `source` argument, `appendMessage` doesn't accept `attachmentKey`, `reopenIfResolved` is not exported.

- [ ] **Step 3: Implement**

In `apps/chatbot/src/conversation/service.ts`:

```typescript
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
      and(eq(schema.chatbotConversations.id, convId), eq(schema.chatbotConversations.status, 'RESOLVED')),
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
```

`transition` and `listMessages` are unchanged (already generic over `ConvStatus`/plain selects).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts test/conversation.test.ts` (from `apps/chatbot`)

Expected: PASS (all tests in the file, including the pre-existing ones — `getOrCreateActiveConversation`'s first test still asserts `a.id === b.id`, which is unaffected; its `status` assertion will need Task 13's rewrite from `'BOT'` to `'OPEN'`, done there since it touches the same file this task is also editing — do that rewrite now, in this step, to keep the file passing: change `expect(a.status).toBe('BOT');` to `expect(a.status).toBe('OPEN');`).

- [ ] **Step 5: Commit**

```bash
git add apps/chatbot/src/conversation/service.ts apps/chatbot/test/conversation.test.ts
git commit -m "feat(chatbot): ticket source on creation, attachment passthrough, reopen-on-resolved"
```

---

### Task 4: `apps/chatbot` orchestrator — remove the bot turn

**Files:**
- Modify: `apps/chatbot/src/conversation/orchestrator.ts`
- Test: `apps/chatbot/test/ws.test.ts` (rewritten in Task 13 — this task changes behavior that file exercises end-to-end; write this task's own narrow test here so it doesn't depend on Task 13 landing first)

**Interfaces:**
- Consumes: `getOrCreateActiveConversation(db, userId, source?)`, `appendMessage(...)`, `reopenIfResolved(db, pub, convId)` from Task 3.
- Produces: `Orchestrator.handleUserMessage(convId, userId, content, attachmentKey?)` — appends the user message (calling `reopenIfResolved` first), and if the ticket was newly created by the WS gateway's own `getOrCreateActiveConversation` call, publishes `queue_update`. No bot turn, no fallback counting, no `escalate` call.

- [ ] **Step 1: Write the failing test**

Add a new file `apps/chatbot/test/orchestrator.test.ts`:

```typescript
import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/conversation/orchestrator.js';
import { getOrCreateActiveConversation } from '../src/conversation/service.js';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

describe('orchestrator', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'orch@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('handleUserMessage appends the message with no bot reply, ticket stays OPEN', async () => {
    const orchestrator = new Orchestrator(t.deps);
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await orchestrator.handleUserMessage(conv.id, userId, 'hello, need help');

    const rows = await t.deps.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, conv.id));
    expect(rows.map((r) => r.role)).toEqual(['user']);

    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('OPEN');
  });

  it('handleUserMessage passes an attachmentKey through to the stored message', async () => {
    const orchestrator = new Orchestrator(t.deps);
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await orchestrator.handleUserMessage(conv.id, userId, 'see attached', 'support/xyz.png');

    const rows = await t.deps.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, conv.id))
      .orderBy(schema.chatbotMessages.createdAt);
    const last = rows[rows.length - 1];
    expect(last?.attachmentKey).toBe('support/xyz.png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts test/orchestrator.test.ts` (from `apps/chatbot`)

Expected: FAIL — `handleUserMessage` currently only takes 3 args and runs a bot turn that inserts a second (`bot`) message.

- [ ] **Step 3: Implement**

Replace `apps/chatbot/src/conversation/orchestrator.ts` in full:

```typescript
import type { ChatbotDeps } from '../server.js';
import { appendMessage, getOrCreateActiveConversation, reopenIfResolved } from './service.js';

export class Orchestrator {
  private inflight = new Map<string, AbortController>();
  private chains = new Map<string, Promise<void>>();

  constructor(private deps: ChatbotDeps) {}

  private enqueue(convId: string, fn: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(convId) ?? Promise.resolve()).then(fn, fn);
    this.chains.set(convId, next);
    return next;
  }

  terminate(convId: string): void {
    this.inflight.get(convId)?.abort();
    this.inflight.delete(convId);
  }

  async handleUserMessage(
    convId: string,
    userId: string,
    content: string,
    attachmentKey?: string,
  ): Promise<void> {
    const { deps } = this;
    await this.enqueue(convId, async () => {
      await reopenIfResolved(deps.db, deps.pub, convId);
      await appendMessage(deps.db, deps.pub, convId, {
        role: 'user',
        senderId: userId,
        content,
        attachmentKey: attachmentKey ?? null,
      });
    });
  }
}

export { getOrCreateActiveConversation };
```

(`inflight`/`terminate` stay — the admin `takeover` route still publishes a `terminate` frame to the conversation channel, and `ws/gateway.ts`'s Redis-fanout handler still routes it to `orchestrator.terminate`. It's now always a no-op since nothing populates `inflight` anymore, which is fine — `Map.get` on an empty map just returns `undefined`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts test/orchestrator.test.ts` (from `apps/chatbot`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chatbot/src/conversation/orchestrator.ts apps/chatbot/test/orchestrator.test.ts
git commit -m "feat(chatbot): remove the LLM bot turn from the orchestrator"
```

---

### Task 5: `apps/chatbot` sweeper — port agent-disconnect recovery to new status names

**Files:**
- Modify: `apps/chatbot/src/conversation/sweeper.ts`
- Test: `apps/chatbot/test/sweeper.test.ts` (new file — `escalation.test.ts`, which covered the sweeper today, is deleted in Task 13)

**Interfaces:**
- Consumes: nothing new from earlier tasks beyond `ConvStatus` already widened in Task 3.
- Produces: `runChatSweeper(deps)` — the agent-presence-based recovery loop now queries/transitions `IN_PROGRESS`→`OPEN` instead of `HUMAN`→`PENDING_HUMAN`. The `idleBot` (status `'BOT'`) and `stalePending` (status `'PENDING_HUMAN'`, calls `emailFallback`) blocks are left completely untouched — they become permanently inert once no row ever has those statuses again, which is the desired "hidden" behavior for the retired auto-escalation path.

- [ ] **Step 1: Write the failing test**

Create `apps/chatbot/test/sweeper.test.ts`:

```typescript
import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runChatSweeper } from '../src/conversation/sweeper.js';
import { getOrCreateActiveConversation } from '../src/conversation/service.js';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

describe('sweeper', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let agentId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'sweep@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
    const [au] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'sweep-agent@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    const [admin] = await t.deps.db
      .insert(schema.adminUsers)
      .values({ userId: au.id, role: 'SUPPORT', status: 'active' })
      .returning();
    agentId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('returns an IN_PROGRESS ticket to OPEN when its agent has gone stale', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await t.deps.db
      .update(schema.chatbotConversations)
      .set({ status: 'IN_PROGRESS', assignedAgentId: agentId })
      .where(eq(schema.chatbotConversations.id, conv.id));
    // no presence written for agentId — simulates a dropped agent

    await runChatSweeper(t.deps);

    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('OPEN');
    expect(row?.assignedAgentId).toBeNull();
  });

  it('leaves an IN_PROGRESS ticket alone while its agent is present', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await t.deps.db
      .update(schema.chatbotConversations)
      .set({ status: 'IN_PROGRESS', assignedAgentId: agentId })
      .where(eq(schema.chatbotConversations.id, conv.id));
    await t.deps.redis.zadd('chatbot:agent:presence', Date.now(), agentId);

    await runChatSweeper(t.deps);

    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('IN_PROGRESS');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts test/sweeper.test.ts` (from `apps/chatbot`)

Expected: FAIL — the sweeper currently only recovers `HUMAN` tickets back to `PENDING_HUMAN`, so the `IN_PROGRESS` ticket in the first test stays `IN_PROGRESS`.

- [ ] **Step 3: Implement**

In `apps/chatbot/src/conversation/sweeper.ts`, change only the final block (`humanConvs` → agent-disconnect recovery). Leave the `idleBot` and `stalePending` blocks exactly as they are:

```typescript
  const inProgressConvs = await deps.db
    .select({
      id: schema.chatbotConversations.id,
      agentId: schema.chatbotConversations.assignedAgentId,
    })
    .from(schema.chatbotConversations)
    .where(eq(schema.chatbotConversations.status, 'IN_PROGRESS'));
  for (const conv of inProgressConvs) {
    if (!conv.agentId) continue;
    const score = await deps.redis.zscore('chatbot:agent:presence', conv.agentId);
    if (score && Number(score) > Date.now() - AGENT_OFFLINE_GRACE_MS) continue;
    await deps.redis.del(`chatbot:conv:${conv.id}:lock`);
    await deps.db
      .update(schema.chatbotConversations)
      .set({ assignedAgentId: null })
      .where(eq(schema.chatbotConversations.id, conv.id));
    await appendMessage(deps.db, deps.pub, conv.id, {
      role: 'system',
      content: 'Your agent got disconnected — reconnecting you…',
    });
    await transition(deps.db, deps.pub, conv.id, {
      from: 'IN_PROGRESS',
      to: 'OPEN',
      type: 'escalate',
      reason: 'agent_drop',
    });
    await deps.pub.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
  }
```

(This replaces the old `const humanConvs = ...` block and its `for` loop in full — same shape, renamed statuses.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts test/sweeper.test.ts` (from `apps/chatbot`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chatbot/src/conversation/sweeper.ts apps/chatbot/test/sweeper.test.ts
git commit -m "feat(chatbot): port agent-disconnect recovery to OPEN/IN_PROGRESS"
```

---

### Task 6: `apps/chatbot` WS gateway — attachment passthrough, `escalate` unwired, `IN_PROGRESS` check

**Files:**
- Modify: `apps/chatbot/src/ws/gateway.ts`
- Test: `apps/chatbot/test/ws.test.ts` (rewritten here — this is the file whose end-to-end behavior this task changes)

**Interfaces:**
- Consumes: `Orchestrator.handleUserMessage(convId, userId, content, attachmentKey?)` from Task 4, `getOrCreateActiveConversation(db, userId, source?)` from Task 3.
- Produces: user `message` WS frames may carry `attachmentKey`; agent `message` frame authorization now checks `status === 'IN_PROGRESS'` instead of `'HUMAN'`.

- [ ] **Step 1: Rewrite `ws.test.ts`**

Replace `apps/chatbot/test/ws.test.ts` in full:

```typescript
import { schema } from '@aivastra/db';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

const SECRET = new TextEncoder().encode('test-jwt-secret-test-jwt-secret');

async function userToken(sub: string) {
  return new SignJWT({ kind: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET);
}

function nextFrame(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 10_000);
    ws.on('message', (buf) => {
      const f = JSON.parse(buf.toString());
      if (f.type === type) {
        clearTimeout(timer);
        resolve(f);
      }
    });
  });
}

describe('ws gateway', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'ws@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('ticket is required and one-time', async () => {
    const noTicket = await fetch(`${t.baseUrl.replace('http', 'ws')}/ws`).catch(() => null);
    const token = await userToken(userId);
    const res = await fetch(`${t.baseUrl}/ws-ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket.length).toBeGreaterThan(16);
    expect(noTicket).toBeNull();
  });

  it('user connects, ready frame reports OPEN, sent message echoes back with no bot reply', async () => {
    const token = await userToken(userId);
    const { ticket } = (await (
      await fetch(`${t.baseUrl}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { ticket: string };

    const wsUrl = `${t.baseUrl.replace('http', 'ws')}/ws?ticket=${ticket}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    const ready = await nextFrame(ws, 'ready');
    expect(ready.status).toBe('OPEN');

    const userMsg = nextFrame(ws, 'message');
    ws.send(JSON.stringify({ type: 'message', content: 'hi there' }));
    const got = await userMsg;
    expect((got.message as { role: string; content: string }).role).toBe('user');
    expect((got.message as { content: string }).content).toBe('hi there');
    ws.close();
  });

  it('sent message carries an attachmentKey through to the persisted message', async () => {
    const token = await userToken(userId);
    const { ticket } = (await (
      await fetch(`${t.baseUrl}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { ticket: string };
    const ws = new WebSocket(`${t.baseUrl.replace('http', 'ws')}/ws?ticket=${ticket}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    await nextFrame(ws, 'ready');
    const userMsg = nextFrame(ws, 'message');
    ws.send(JSON.stringify({ type: 'message', content: 'see this', attachmentKey: 'support/a.jpg' }));
    const got = await userMsg;
    expect((got.message as { attachmentKey: string | null }).attachmentKey).toBe('support/a.jpg');
    ws.close();
  });

  it('rejects ws without ticket', async () => {
    const wsUrl = `${t.baseUrl.replace('http', 'ws')}/ws`;
    const ws = new WebSocket(wsUrl);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
      setTimeout(() => resolve(-1), 5000);
    });
    expect(code).toBe(4401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts test/ws.test.ts` (from `apps/chatbot`)

Expected: FAIL — `ready.status` is currently `'BOT'`, and the gateway doesn't forward `attachmentKey`.

- [ ] **Step 3: Implement**

In `apps/chatbot/src/ws/gateway.ts`, two changes:

1. The user socket's `message` frame handler — pass `attachmentKey` through, drop the `escalate` branch:

```typescript
      const parsed = WsClientFrame.safeParse(JSON.parse(buf.toString()));
      if (!parsed.success) {
        socket.send(
          JSON.stringify({ type: 'error', code: 'BAD_FRAME', message: 'invalid frame' }),
        );
        return;
      }
      const f = parsed.data;
      if (f.type === 'message') {
        const rlKey = `chatbot:rl:${principal.userId}`;
        const n = await deps.redis.incr(rlKey);
        if (n === 1) await deps.redis.expire(rlKey, 30);
        if (n > 10) {
          socket.send(
            JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'slow down' }),
          );
          return;
        }
        await orchestrator.handleUserMessage(
          conv.id,
          principal.userId,
          f.content,
          f.attachmentKey,
        );
      } else if (f.type === 'typing')
        await deps.pub.publish(
          `chatbot:conv:${conv.id}`,
          JSON.stringify({ type: 'typing', conversationId: conv.id, role: 'user' }),
        );
```

(the `else if (f.type === 'escalate')` branch is removed — `WsClientFrame` still permits a client to send `{ type: 'escalate' }`, it's simply now unhandled and silently ignored, same as any other frame variant the gateway doesn't branch on.)

2. The agent socket's `message` frame handler — `status` check renamed:

```typescript
        } else if (f.type === 'message') {
          const [conv] = await deps.db
            .select()
            .from(schema.chatbotConversations)
            .where(
              and(
                eq(schema.chatbotConversations.id, f.conversationId),
                eq(schema.chatbotConversations.status, 'IN_PROGRESS'),
                eq(schema.chatbotConversations.assignedAgentId, adminUserId),
              ),
            );
          if (!conv) {
            socket.send(
              JSON.stringify({ type: 'error', code: 'FORBIDDEN', message: 'not assigned' }),
            );
            return;
          }
          await appendMessage(deps.db, deps.pub, f.conversationId, {
            role: 'agent',
            senderId: adminUserId,
            content: f.content,
          });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts test/ws.test.ts` (from `apps/chatbot`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chatbot/src/ws/gateway.ts apps/chatbot/test/ws.test.ts
git commit -m "feat(chatbot): attachment passthrough on WS, drop dead escalate wiring, IN_PROGRESS check"
```

---

### Task 7: `apps/api` admin chatbot routes — status renames, resolve, ticket-field edits

**Files:**
- Modify: `apps/api/src/modules/admin/chatbot.routes.ts`
- Modify: `apps/api/test/integration/admin-chatbot-hitl.test.ts` (this file already exists and already covers claim/end against the old `PENDING_HUMAN`/`HUMAN` statuses — update it in place, don't create a new file)

**Interfaces:**
- Consumes: nothing new beyond the widened statuses.
- Produces: `POST /admin/chatbot/conversations/:id/claim` now requires `status === 'OPEN'`, sets `IN_PROGRESS`. `POST /admin/chatbot/conversations/:id/end` requires `IN_PROGRESS`, sets `CLOSED`. New `POST /admin/chatbot/conversations/:id/resolve` requires `IN_PROGRESS` + assigned to the caller, sets `RESOLVED`. New `PATCH /admin/chatbot/conversations/:id` accepts `{ subject?, category?, priority? }`.

- [ ] **Step 1: Update the existing tests and add new ones**

`apps/api/test/integration/admin-chatbot-hitl.test.ts` already has the exact harness pattern to follow: `buildTestApp(c)` returns a `TestApp` (a live Fastify instance with `.db` and `.inject`), an admin is seeded by inserting `users` + `adminUsers` rows directly then logging in via `POST /admin/auth/login` through `app.inject`, and `seedConv(status)` seeds a `chatbotConversations` row directly. Rewrite the file in full:

```typescript
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('admin chatbot hitl', () => {
  let c: Containers;
  let app: TestApp;
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const passwordHash = await hashPassword('password123');
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: 'hitl-admin@x.com', passwordHash, emailVerified: true })
      .returning();
    const [admin] = await app.db
      .insert(schema.adminUsers)
      .values({ userId: user.id, role: 'SUPER_ADMIN', passwordHash })
      .returning();
    adminUserId = admin.id;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: 'hitl-admin@x.com', password: 'password123' },
    });
    adminToken = res.json().accessToken;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedConv(status: string) {
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: `hitl-user-${Date.now()}-${Math.random()}@x.com`, passwordHash: '', emailVerified: true })
      .returning();
    const [conv] = await app.db
      .insert(schema.chatbotConversations)
      .values({ userId: u.id, status })
      .returning();
    return { user: u, conv };
  }

  it('claim sets OPEN→IN_PROGRESS', async () => {
    const { conv } = await seedConv('OPEN');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('IN_PROGRESS');
    expect(res.json().assignedAgentId).toBe(adminUserId);
  });

  it('second claim 409', async () => {
    const { conv } = await seedConv('OPEN');
    await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res2.statusCode).toBe(409);
  });

  it('resolve sets IN_PROGRESS→RESOLVED for the assigned agent', async () => {
    const { conv } = await seedConv('OPEN');
    await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/resolve`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('RESOLVED');
  });

  it('resolve fails for an unassigned agent', async () => {
    const { conv } = await seedConv('IN_PROGRESS');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/resolve`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('end sets IN_PROGRESS→CLOSED (assigned agent only)', async () => {
    const { conv } = await seedConv('OPEN');
    const claimed = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(claimed.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/end`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CLOSED');
    expect(res.json().closedAt).toBeTruthy();
  });

  it('end fails for unassigned agent', async () => {
    const { conv } = await seedConv('IN_PROGRESS');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/chatbot/conversations/${conv.id}/end`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('PATCH updates subject/category/priority', async () => {
    const { conv } = await seedConv('OPEN');
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/chatbot/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { subject: 'Refund question', category: 'billing', priority: 'high' },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.subject).toBe('Refund question');
    expect(row?.category).toBe('billing');
    expect(row?.priority).toBe('high');
  });

  it('duty toggle round-trips', async () => {
    const on = await app.inject({
      method: 'GET',
      url: '/admin/chatbot/duty',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(on.json().on).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/admin/chatbot/duty',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { on: true },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/admin/chatbot/duty',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(after.json().on).toBe(true);
  });
});
```

(This drops the old `'claim sets PENDING_HUMAN→HUMAN'` test — superseded by `'claim sets OPEN→IN_PROGRESS'` — and the old `'end fails for unassigned agent'` seeding `'HUMAN'` — superseded by the same test now seeding `'IN_PROGRESS'`. Every other test in the original file (`duty toggle round-trips`) is carried over unchanged.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/admin-chatbot-hitl.test.ts` (from `apps/api`)

Expected: FAIL — claim currently checks `fromStatus: 'PENDING_HUMAN'` (no `'OPEN'` ticket ever matches), there is no `resolve` route, no `PATCH` route.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/admin/chatbot.routes.ts`:

1. Change `assign()`'s hardcoded target status and the `claim` route's `fromStatus`:

```typescript
  async function assign(
    convId: string,
    fromStatus: string,
    type: 'claim' | 'takeover',
    userId: string,
  ) {
    const agentId = await adminRowId(userId, app);
    const got = await app.redis.set(`chatbot:conv:${convId}:lock`, agentId, 'NX');
    if (!got) throw new AppError('ALREADY_CLAIMED', 409, 'conversation already claimed');
    const [row] = await app.db
      .update(schema.chatbotConversations)
      .set({
        status: 'IN_PROGRESS',
        assignedAgentId: agentId,
        ...(type === 'takeover' ? { escalationReason: 'agent_join' } : {}),
      })
      .where(
        and(
          eq(schema.chatbotConversations.id, convId),
          eq(schema.chatbotConversations.status, fromStatus),
        ),
      )
      .returning();
    if (!row) {
      await app.redis.del(`chatbot:conv:${convId}:lock`);
      throw new AppError('BAD_STATE', 409, `conversation is not ${fromStatus}`);
    }
    await app.db.insert(schema.chatbotEvents).values({
      conversationId: convId,
      type,
      actorId: agentId,
      fromStatus,
      toStatus: 'IN_PROGRESS',
      reason: type === 'takeover' ? 'agent_join' : null,
    });
    await publishConv(convId, { type: 'terminate' }, app);
    await publishConv(
      convId,
      {
        type: 'state_change',
        conversationId: convId,
        status: 'IN_PROGRESS',
        reason: type === 'takeover' ? 'agent_join' : null,
      },
      app,
    );
    await systemMessage(convId, 'A support agent has joined the conversation.', app);
    await publishQueue(app);
    return row;
  }

  app.post(
    '/admin/chatbot/conversations/:id/claim',
    { preHandler: LIVE, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => assign((req.params as { id: string }).id, 'OPEN', 'claim', req.userId),
  );
```

(The `takeover` route below stays exactly as it is — still hardcoded to `fromStatus: 'BOT'`, which no ticket will ever have again. It stays registered but permanently unreachable via the UI, since Task 12 removes the "Bot Live"/"Takeover" panel from `ChatInboxPage`. This is deliberate — a route body left in place with no live caller, per the hide-don't-delete constraint, rather than deleting the route.)

2. Change `end`'s `fromStatus` check:

```typescript
  app.post(
    '/admin/chatbot/conversations/:id/end',
    { preHandler: LIVE, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const agentId = await adminRowId(req.userId, app);
      const [row] = await app.db
        .update(schema.chatbotConversations)
        .set({ status: 'CLOSED', closedAt: new Date() })
        .where(
          and(
            eq(schema.chatbotConversations.id, id),
            eq(schema.chatbotConversations.status, 'IN_PROGRESS'),
            eq(schema.chatbotConversations.assignedAgentId, agentId),
          ),
        )
        .returning();
      if (!row) throw new AppError('BAD_STATE', 409, 'not your active IN_PROGRESS conversation');
      await app.db.insert(schema.chatbotEvents).values({
        conversationId: id,
        type: 'close',
        actorId: agentId,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'CLOSED',
      });
      await app.redis.del(`chatbot:conv:${id}:lock`);
      await systemMessage(id, 'The agent ended this conversation.', app);
      await publishConv(
        id,
        {
          type: 'state_change',
          conversationId: id,
          status: 'CLOSED',
          reason: null,
        },
        app,
      );
      return row;
    },
  );
```

3. Add a new `resolve` route (place it right after `end`):

```typescript
  app.post(
    '/admin/chatbot/conversations/:id/resolve',
    { preHandler: LIVE, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const agentId = await adminRowId(req.userId, app);
      const [row] = await app.db
        .update(schema.chatbotConversations)
        .set({ status: 'RESOLVED' })
        .where(
          and(
            eq(schema.chatbotConversations.id, id),
            eq(schema.chatbotConversations.status, 'IN_PROGRESS'),
            eq(schema.chatbotConversations.assignedAgentId, agentId),
          ),
        )
        .returning();
      if (!row) throw new AppError('BAD_STATE', 409, 'not your active IN_PROGRESS conversation');
      await app.db.insert(schema.chatbotEvents).values({
        conversationId: id,
        type: 'resolve',
        actorId: agentId,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'RESOLVED',
      });
      await systemMessage(id, 'The agent marked this ticket resolved.', app);
      await publishConv(
        id,
        { type: 'state_change', conversationId: id, status: 'RESOLVED', reason: null },
        app,
      );
      return row;
    },
  );
```

4. Add a new `PATCH` route for ticket fields (place it after `resolve`):

```typescript
  app.patch(
    '/admin/chatbot/conversations/:id',
    {
      preHandler: LIVE,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          subject: z.string().max(200).optional(),
          category: z.enum(['billing', 'bug', 'order', 'account', 'other']).optional(),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { subject?: string; category?: string; priority?: string };
      const [row] = await app.db
        .update(schema.chatbotConversations)
        .set(body)
        .where(eq(schema.chatbotConversations.id, id))
        .returning();
      if (!row) throw new AppError('NOT_FOUND', 404, 'conversation not found');
      return row;
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/admin-chatbot-hitl.test.ts` (from `apps/api`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/chatbot.routes.ts apps/api/test/integration/admin-chatbot-hitl.test.ts
git commit -m "feat(api): rename ticket statuses in admin routes, add resolve + field-edit routes"
```

---

### Task 8: `apps/api` `/v1/support` — write to the ticket instead of `contact_requests`

**Files:**
- Modify: `apps/api/src/modules/support/routes.ts`
- Test: `apps/api/test/integration/support.test.ts` (new)

**Interfaces:**
- Consumes: `schema.chatbotConversations`/`schema.chatbotMessages` (Task 1), the widened status set.
- Produces: `POST /v1/support` now returns `{ ticketId: string }` (the conversation id) instead of `{ id }` (a `contactRequests` id). Request/response `contentType` set stays the same for `/v1/support/presign`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/support.test.ts`, following the same `app.inject` + direct-DB-seed harness pattern confirmed in Task 7's `admin-chatbot-hitl.test.ts` and in `apps/api/test/integration/issue-invoice.test.ts` (user login via `POST /v1/auth/login`, `remoteAddress` set per test to avoid colliding on a shared rate-limit bucket — per this repo's testing rule to use distinct RFC 5737 addresses):

```typescript
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/v1/support writes a ticket', () => {
  let c: Containers;
  let app: TestApp;
  let userToken: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const passwordHash = await hashPassword('password123');
    await app.db
      .insert(schema.users)
      .values({ email: 'support-user@x.com', passwordHash, emailVerified: true });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '192.0.2.10',
      payload: { email: 'support-user@x.com', password: 'password123' },
    });
    userToken = login.json().accessToken;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('creates an OPEN ticket with source support_modal on first submit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'My order looks wrong' },
    });
    expect(res.statusCode).toBe(200);
    const { ticketId } = res.json() as { ticketId: string };
    const [conv] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(conv?.status).toBe('OPEN');
    expect(conv?.source).toBe('support_modal');
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe('My order looks wrong');
  });

  it('a second submit appends to the same active ticket', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'first message' },
    });
    const { ticketId } = first.json() as { ticketId: string };

    const second = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'second message' },
    });
    expect((second.json() as { ticketId: string }).ticketId).toBe(ticketId);

    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId));
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });

  it('passes attachmentKey through to the stored message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'see photo', attachmentKey: 'support/xyz.jpg' },
    });
    const { ticketId } = res.json() as { ticketId: string };
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId))
      .orderBy(schema.chatbotMessages.createdAt);
    expect(msgs[msgs.length - 1]?.attachmentKey).toBe('support/xyz.jpg');
  });

  it('a message to a RESOLVED ticket reopens it to OPEN and clears the agent', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'first' },
    });
    const { ticketId } = first.json() as { ticketId: string };
    await app.db
      .update(schema.chatbotConversations)
      .set({ status: 'RESOLVED', assignedAgentId: null })
      .where(eq(schema.chatbotConversations.id, ticketId));

    await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'reopening this' },
    });

    const [conv] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(conv?.status).toBe('OPEN');
  });
});
```

(Every test in this file shares one user/one ticket lineage on purpose — each submit either creates or continues that same user's single active ticket, matching the one-active-ticket-per-user constraint. If this repo's WS/REST rate limiter for `/v1/support` also keys by IP rather than only by user, the shared `remoteAddress` across tests in this file could throttle — if Step 2 fails with a 429 instead of the expected diff, split `remoteAddress` per `it()` block using distinct `192.0.2.x` addresses, RFC 5737 TEST-NET-1.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/support.test.ts` (from `apps/api`)

Expected: FAIL — `/v1/support` currently inserts into `contact_requests` and returns `{ id }`, not `{ ticketId }`.

- [ ] **Step 3: Implement**

Replace the `POST /v1/support` handler in `apps/api/src/modules/support/routes.ts` (the presign route above it is unchanged):

```typescript
  // POST /v1/support — submit to (or continue) the caller's active ticket
  app.post(
    '/v1/support',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          message: z.string().min(1).max(3000),
          attachmentKey: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { message, attachmentKey } = req.body as { message: string; attachmentKey?: string };

      const [existing] = await app.db
        .select()
        .from(schema.chatbotConversations)
        .where(
          and(
            eq(schema.chatbotConversations.userId, req.userId),
            sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
          ),
        );
      let convId: string;
      let isNew = false;
      if (existing) {
        convId = existing.id;
        if (existing.status === 'RESOLVED') {
          await app.db
            .update(schema.chatbotConversations)
            .set({ status: 'OPEN', assignedAgentId: null })
            .where(eq(schema.chatbotConversations.id, convId));
        }
      } else {
        const [created] = await app.db
          .insert(schema.chatbotConversations)
          .values({ userId: req.userId, source: 'support_modal' })
          .onConflictDoNothing()
          .returning();
        if (created) {
          convId = created.id;
          isNew = true;
        } else {
          const [winner] = await app.db
            .select()
            .from(schema.chatbotConversations)
            .where(
              and(
                eq(schema.chatbotConversations.userId, req.userId),
                sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
              ),
            );
          convId = winner.id;
        }
      }

      const [msgRow] = await app.db
        .insert(schema.chatbotMessages)
        .values({
          conversationId: convId,
          role: 'user',
          senderId: req.userId,
          content: message,
          attachmentKey: attachmentKey ?? null,
        })
        .returning();
      await app.db
        .update(schema.chatbotConversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.chatbotConversations.id, convId));

      await app.redis.publish(
        `chatbot:conv:${convId}`,
        JSON.stringify({
          type: 'message',
          message: {
            id: msgRow.id,
            conversationId: convId,
            role: 'user',
            senderId: req.userId,
            content: message,
            attachmentKey: msgRow.attachmentKey,
            attachmentType: msgRow.attachmentType,
            createdAt: msgRow.createdAt.toISOString(),
          },
        }),
      );
      if (isNew) {
        await app.redis.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
      }

      return { ticketId: convId };
    },
  );
```

The file's existing top-of-file imports are `import { schema } from '@aivastra/db';` and `import { eq } from 'drizzle-orm';` — leave the first as-is and extend only the second:

```typescript
import { and, eq, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/support.test.ts` (from `apps/api`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/support/routes.ts apps/api/test/integration/support.test.ts
git commit -m "feat(api): /v1/support writes into the ticket system instead of contact_requests"
```

---

### Task 9: `apps/api` `/v1/contact` — same treatment

**Files:**
- Modify: `apps/api/src/modules/jobs/routes.ts:1088-1118`
- Test: `apps/api/test/integration/contact.test.ts` (new)

**Interfaces:**
- Consumes: same as Task 8.
- Produces: `POST /v1/contact` returns `{ ticketId: string }`; ticket `source: 'contact_us'`, no attachment.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/contact.test.ts`, same `app.inject` harness pattern as Task 8, against `/v1/contact` and asserting `source === 'contact_us'`:

```typescript
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/v1/contact writes a ticket', () => {
  let c: Containers;
  let app: TestApp;
  let userToken: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const passwordHash = await hashPassword('password123');
    await app.db
      .insert(schema.users)
      .values({ email: 'contact-user@x.com', passwordHash, emailVerified: true });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '192.0.2.20',
      payload: { email: 'contact-user@x.com', password: 'password123' },
    });
    userToken = login.json().accessToken;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('creates an OPEN ticket with source contact_us', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        source: 'contact-us',
        message: 'Question about pricing',
      },
    });
    expect(res.statusCode).toBe(200);
    const { ticketId } = res.json() as { ticketId: string };
    const [conv] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(conv?.status).toBe('OPEN');
    expect(conv?.source).toBe('contact_us');
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId));
    expect(msgs[0]?.content).toBe('Question about pricing');
  });

  it('a message-less contact submit still opens a ticket with placeholder content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        source: 'contact-us',
      },
    });
    expect(res.statusCode).toBe(200);
    const { ticketId } = res.json() as { ticketId: string };
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId));
    expect(msgs[msgs.length - 1]?.content).toContain('Test User');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/contact.test.ts` (from `apps/api`)

Expected: FAIL — the route currently inserts into `contact_requests` and returns `undefined` for `ticketId` (the current handler returns nothing on success — check its `reply` usage; either way, the DB assertions here won't find a `chatbot_conversations` row from this route today).

- [ ] **Step 3: Implement**

Replace the `POST /v1/contact` handler body in `apps/api/src/modules/jobs/routes.ts:1088-1118`. Keep the route registration (`app.post('/v1/contact', { preHandler: app.requireUser, schema: {...} }, ...)`) and its Zod body schema exactly as they are — only the handler body changes:

```typescript
    async (req, reply) => {
      const body = req.body as {
        name: string;
        email: string;
        phone: string;
        source?: string;
        message?: string;
      };

      const [existing] = await app.db
        .select()
        .from(schema.chatbotConversations)
        .where(
          and(
            eq(schema.chatbotConversations.userId, req.userId),
            sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
          ),
        );
      let convId: string;
      let isNew = false;
      if (existing) {
        convId = existing.id;
        if (existing.status === 'RESOLVED') {
          await app.db
            .update(schema.chatbotConversations)
            .set({ status: 'OPEN', assignedAgentId: null })
            .where(eq(schema.chatbotConversations.id, convId));
        }
      } else {
        const [created] = await app.db
          .insert(schema.chatbotConversations)
          .values({ userId: req.userId, source: 'contact_us' })
          .onConflictDoNothing()
          .returning();
        if (created) {
          convId = created.id;
          isNew = true;
        } else {
          const [winner] = await app.db
            .select()
            .from(schema.chatbotConversations)
            .where(
              and(
                eq(schema.chatbotConversations.userId, req.userId),
                sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
              ),
            );
          convId = winner.id;
        }
      }

      const content = body.message?.trim() || `Contact request from ${body.name} (${body.email}, ${body.phone})`;
      const [msgRow] = await app.db
        .insert(schema.chatbotMessages)
        .values({ conversationId: convId, role: 'user', senderId: req.userId, content })
        .returning();
      await app.db
        .update(schema.chatbotConversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.chatbotConversations.id, convId));

      await app.redis.publish(
        `chatbot:conv:${convId}`,
        JSON.stringify({
          type: 'message',
          message: {
            id: msgRow.id,
            conversationId: convId,
            role: 'user',
            senderId: req.userId,
            content,
            attachmentKey: null,
            attachmentType: null,
            createdAt: msgRow.createdAt.toISOString(),
          },
        }),
      );
      if (isNew) {
        await app.redis.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
      }

      return { ticketId: convId };
    },
```

No import changes needed — `apps/api/src/modules/jobs/routes.ts` already imports `and` and `sql` from `drizzle-orm` (line 14: `import { and, asc, desc, eq, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';`) and `schema` from `@aivastra/db` (line 1), both used elsewhere in this large file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts test/integration/contact.test.ts` (from `apps/api`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/jobs/routes.ts apps/api/test/integration/contact.test.ts
git commit -m "feat(api): /v1/contact writes into the ticket system instead of contact_requests"
```

---

### Task 10: `apps/catalogues-web` chat bubble — status renames, attachments, drop dead escalate UI

**Files:**
- Modify: `apps/catalogues-web/src/components/chat-widget.tsx`

**Interfaces:**
- Consumes: `WsClientFrameT`'s widened `message` variant (Task 2), the new ticket statuses.
- Produces: no new exports — this is a leaf UI component.

- [ ] **Step 1: Update status handling**

Change the status union and the header label switch:

```typescript
const [status, setStatus] = useState<
  'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
>('OPEN');
```

```typescript
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              {status === 'OPEN' && 'Waiting for an agent…'}
              {status === 'IN_PROGRESS' && 'Live agent'}
              {status === 'RESOLVED' && 'Marked resolved — send a message to reopen'}
              {status === 'CLOSED' && 'Conversation ended'}
            </div>
```

`reset()`'s `setStatus('BOT')` becomes `setStatus('OPEN')`.

- [ ] **Step 2: Remove the dead "Talk to a human" affordance**

Delete the `talkToHuman` function and the block that renders its button (the `{status === 'BOT' && (...)}` block at the bottom of the panel) — every ticket now already targets a human by default, so there's nothing left for it to do. `type: 'escalate'` stays a valid frame in the shared schema (Task 2 left it there); this component simply stops sending it.

- [ ] **Step 3: Add attachment upload**

Add state and a file input alongside the existing message input:

```typescript
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
```

```typescript
  async function send() {
    const content = input.trim();
    if ((!content && !pendingFile) || !wsRef.current || status === 'CLOSED') return;
    let attachmentKey: string | undefined;
    if (pendingFile) {
      setUploading(true);
      try {
        const token = getToken();
        const presignRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/v1/support/presign`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ contentType: pendingFile.type }),
          },
        );
        const { uploadUrl, attachmentKey: key } = (await presignRes.json()) as {
          uploadUrl: string;
          attachmentKey: string;
        };
        await fetch(uploadUrl, {
          method: 'PUT',
          body: pendingFile,
          headers: { 'Content-Type': pendingFile.type },
        });
        attachmentKey = key;
      } finally {
        setUploading(false);
        setPendingFile(null);
      }
    }
    wsRef.current.send(JSON.stringify({ type: 'message', content: content || '(image)', attachmentKey }));
    setInput('');
  }
```

(Reuses `/v1/support/presign` on `apps/api` — unchanged by Task 8, still returns a presigned PUT via `keys.supportAttachment`. Only accepted content types are `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, matching that route's existing `CONTENT_TYPE_TO_EXT` map.)

Add a small file input next to the send button (near the existing `<input>` for `input`/`send`):

```tsx
<input
  type="file"
  accept="image/jpeg,image/png,image/webp"
  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
  style={{ fontSize: '11px' }}
/>
```

And render attachments inline in the message list — inside the existing `messages.map((m) => ...)` block, after the text content:

```tsx
{m.attachmentKey && (
  <img
    src={`${process.env.NEXT_PUBLIC_API_URL}/v1/support/attachment/${encodeURIComponent(m.attachmentKey)}`}
    alt="attachment"
    style={{ maxWidth: '100%', borderRadius: 8, marginTop: 4 }}
  />
)}
```

This references an attachment-serving route that doesn't exist yet on `apps/api` — add it now as part of this task, since the chat bubble needs somewhere to fetch the image from (an S3-style key isn't directly browser-fetchable). In `apps/api/src/modules/support/routes.ts`, add:

```typescript
  // GET /v1/support/attachment/:key — redirect to a short-lived presigned GET
  app.get(
    '/v1/support/attachment/*',
    { preHandler: app.requireUser },
    async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      const { url } = await app.storage.presignGet(key, 300);
      return reply.redirect(url);
    },
  );
```

(Path-param wildcard matches Fastify's existing convention elsewhere in this codebase for key-shaped params — verify against another `app.get('/.../*', ...)` route in `apps/api/src` for the exact wildcard param name Fastify assigns before finalizing; adjust `req.params as { '*': string }` if this repo's Fastify version names it differently.)

- [ ] **Step 4: Manual verification**

Run: `pnpm --filter @aivastra/web dev` and `pnpm --filter @aivastra/api dev` together, open the app, open the chat bubble, send a text message, send an image attachment, confirm both render and the ticket status label matches what `ChatInboxPage` (once Task 12 lands) shows for the same ticket.

- [ ] **Step 5: Commit**

```bash
git add apps/catalogues-web/src/components/chat-widget.tsx apps/api/src/modules/support/routes.ts
git commit -m "feat(web): chat bubble attachment upload, ticket status renames, drop dead escalate button"
```

---

### Task 11: `apps/catalogues-web` Contact Us + Support modal — success copy

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/contact-us/page.tsx`
- Modify: `apps/catalogues-web/src/components/SupportModal.tsx`

**Interfaces:**
- Consumes: nothing new — request/response shapes are unchanged from these components' point of view (`{ ticketId }` replaces `{ id }` in the response, but neither component reads the response body today, so no code change is needed there beyond copy).

- [ ] **Step 1: Update Contact Us success copy**

In `apps/catalogues-web/src/app/(app)/contact-us/page.tsx`, near line 446, change:

```tsx
Thank you for reaching out. We&apos;ve received your message and will get back to
```

to:

```tsx
Thank you for reaching out. Your message opened a support ticket — an agent will follow up in your chat, or you can continue the conversation any time from the chat icon.
```

(Read the full surrounding sentence at that line before editing — this replaces the clause, keeping the rest of that success block's structure and any trailing text/links intact.)

- [ ] **Step 2: Update Support modal success copy**

In `apps/catalogues-web/src/components/SupportModal.tsx` (around line 214-221):

```tsx
<div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
  Your message has been sent!
</div>
<div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>
  We&apos;ll get back to you as soon as possible.
</div>
```

becomes:

```tsx
<div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
  Ticket opened!
</div>
<div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>
  An agent will respond in your chat — tap the chat icon any time to continue.
</div>
```

- [ ] **Step 3: Manual verification**

Run: `pnpm --filter @aivastra/web dev`, submit Contact Us and the Support modal each once, confirm the new copy renders and (cross-check against Task 8/9's integration tests already passing) a ticket was actually created.

- [ ] **Step 4: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/contact-us/page.tsx" apps/catalogues-web/src/components/SupportModal.tsx
git commit -m "copy: reflect ticket creation in Contact Us and Support modal success states"
```

---

### Task 12: `apps/admin-web` — `ChatInboxPage` becomes a ticket queue

**Files:**
- Modify: `apps/admin-web/src/pages/ChatInboxPage.tsx`
- Modify: `apps/admin-web/src/lib/chatws.ts` (widen `ChatMessageT`/`WsServerFrameT` status strings — these are plain string-typed already, so likely no change needed; verify)

**Interfaces:**
- Consumes: `GET /admin/chatbot/conversations?status=OPEN|IN_PROGRESS`, `POST .../claim`, `POST .../resolve` (new, Task 7), `POST .../end`, `PATCH /admin/chatbot/conversations/:id` (new, Task 7).

- [ ] **Step 1: Update `load()` and remove the Bot Live panel**

```typescript
  const [queue, setQueue] = useState<ConvRow[]>([]);
  const [myTickets, setMyTickets] = useState<ConvRow[]>([]);
  const [onDuty, setOnDuty] = useState(false);
  // ...(selectedConv, messages, status, input, typing, refs unchanged)

  const load = useCallback(async () => {
    const [q, m, d] = await Promise.all([
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=OPEN'),
      apiFetch<{ rows: ConvRow[] }>('/admin/chatbot/conversations?status=IN_PROGRESS'),
      apiFetch<{ on: boolean }>('/admin/chatbot/duty'),
    ]);
    setQueue(q.rows);
    setMyTickets(m.rows);
    setOnDuty(d.on);
  }, []);
```

Extend the `ConvRow` interface with the new fields:

```typescript
interface ConvRow {
  id: string;
  userId: string;
  status: string;
  source: string;
  category: string | null;
  priority: string;
  subject: string | null;
  assignedAgentId: string | null;
  escalationReason: string | null;
  lastMessageAt: string;
  userEmail: string;
  createdAt: string;
}
```

Delete the entire "Bot Live" grid column (the `<div>` block rendering `botLive.map(...)` with its "Takeover" button) and change the layout's `gridTemplateColumns` from `'1fr 1fr 1fr'` to `'1fr 1fr'`. Rename the remaining "My Conversations" column's state/label to `myTickets`/`My Tickets`, and its status badge lookups (`[...queue, ...botLive, ...myConvs]` → `[...queue, ...myTickets]` in `selectConv`).

- [ ] **Step 2: Show subject/category/priority on queue rows, sort by priority then age**

```tsx
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const sortedQueue = [...queue].sort((a, b) => {
  const p = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
  if (p !== 0) return p;
  return new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime();
});
```

Use `sortedQueue` instead of `queue` in the queue column's `.map(...)`. In each row, add above the existing `userEmail`/`escalationReason` line:

```tsx
<div style={{ fontSize: 12, fontWeight: 600 }}>{c.subject || '(no subject)'}</div>
<div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
  {c.category && <span className="badge">{c.category}</span>}
  <span
    className="badge"
    style={{
      background:
        c.priority === 'urgent' ? '#fee2e2' : c.priority === 'high' ? '#fef3c7' : undefined,
    }}
  >
    {c.priority}
  </span>
</div>
```

- [ ] **Step 3: Add `resolveConv`, rename `endConv`'s call-site label, add field-edit inputs**

```typescript
  async function resolveConv(id: string) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}/resolve`, { method: 'POST' });
      toast({ title: 'Resolved' });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to resolve',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function updateFields(id: string, fields: { subject?: string; category?: string; priority?: string }) {
    try {
      await apiFetch(`/admin/chatbot/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update ticket',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }
```

In the conversation pane header (replacing the single "End" button), add both actions when `status === 'IN_PROGRESS'`:

```tsx
{status === 'IN_PROGRESS' && (
  <div style={{ display: 'flex', gap: 8 }}>
    <button className="btn sm ghost" onClick={() => resolveConv(selectedConv)}>
      Resolve
    </button>
    <button className="btn sm ghost" onClick={() => endConv(selectedConv)}>
      Close
    </button>
  </div>
)}
```

- [ ] **Step 4: Render attachments in the message pane**

Inside the existing `messages.map((m) => ...)` block, after `renderMessageContent(m.content)`:

```tsx
{m.attachmentKey && (
  <img
    src={`${CHATBOT_URL_OR_API_BASE}/v1/support/attachment/${encodeURIComponent(m.attachmentKey)}`}
    alt="attachment"
    style={{ maxWidth: '100%', borderRadius: 6, marginTop: 4, cursor: 'pointer' }}
    onClick={() => window.open(
      `${CHATBOT_URL_OR_API_BASE}/v1/support/attachment/${encodeURIComponent(m.attachmentKey!)}`,
      '_blank',
    )}
  />
)}
```

`CHATBOT_URL_OR_API_BASE` should resolve to whatever base URL `apiFetch` in `apps/admin-web/src/lib/data.ts` already targets for `/admin/*` calls (same API host serves `/v1/support/attachment/*` from Task 10) — read that file's base-URL constant and reuse it rather than introducing a second one.

Update `sendMsg()`'s guard from `status !== 'HUMAN'` to `status !== 'IN_PROGRESS'`.

- [ ] **Step 5: Manual verification**

Run `pnpm --filter @aivastra/admin dev` and `pnpm --filter @aivastra/api dev`. As an admin: see a ticket land in Queue after submitting via Contact Us/Support modal/chat bubble (Tasks 8-10), claim it, see it move to My Tickets, send a reply, resolve it, confirm a new message from the user reopens it back into Queue (Task 3's `reopenIfResolved` / Task 8-9's reopen logic).

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/pages/ChatInboxPage.tsx
git commit -m "feat(admin): ChatInboxPage becomes a two-column ticket queue with resolve + field edits"
```

---

### Task 13: Relabel the legacy Contact Requests admin page

**Files:**
- Modify: `apps/admin-web/src/pages/ContactRequestsPage.tsx`
- Modify: `apps/admin-web/src/components/Sidebar.tsx`

**Interfaces:** none — cosmetic only. `contact_requests` gets no new writes as of Tasks 8/9, but its existing rows and this read page stay, per the spec's "no destructive drop of existing support history."

- [ ] **Step 1: Add a legacy banner and relabel the nav entry**

In `ContactRequestsPage.tsx`, add a banner at the top of the page body (above the existing table/list):

```tsx
<div
  style={{
    padding: '10px 14px',
    marginBottom: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r)',
    fontSize: 13,
    color: 'var(--muted)',
  }}
>
  Legacy history — Contact Us and the Support modal now open tickets in{' '}
  <strong>Chat Inbox</strong> instead of rows here. This page shows submissions from before
  that change.
</div>
```

In `Sidebar.tsx`, find the nav entry pointing at this page (grep `ContactRequestsPage`'s route or label to locate it) and change its label to `Contact Requests (Legacy)`.

- [ ] **Step 2: Manual verification**

Run `pnpm --filter @aivastra/admin dev`, open the page, confirm the banner renders and the sidebar label updated.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/pages/ContactRequestsPage.tsx apps/admin-web/src/components/Sidebar.tsx
git commit -m "chore(admin): label Contact Requests as legacy now that intake goes through tickets"
```

---

### Task 14: Delete stale tests, sweep remaining status literals

**Files:**
- Delete: `apps/chatbot/test/bot.test.ts`
- Delete: `apps/chatbot/test/escalation.test.ts`
- Modify: `apps/chatbot/test/ratelimit.test.ts` (uses `makeGenModel` override that's now irrelevant but harmless — verify it still passes as-is; only touch if it fails)

**Interfaces:** none — this task is cleanup + a final consistency pass, no new production code.

- [ ] **Step 1: Delete the two stale test files**

```bash
git rm apps/chatbot/test/bot.test.ts apps/chatbot/test/escalation.test.ts
```

These asserted `runBotTurn` behavior and availability-gated escalation/email-fallback behavior, neither of which the live code path exercises anymore (Task 4 removed the call sites; the underlying functions in `agent/bot.ts` and `conversation/escalation.ts` are hidden, not deleted, per the global constraint — but there is no longer any test asserting they run, because they don't).

- [ ] **Step 2: Run the full chatbot test suite**

Run: `pnpm --filter @aivastra/chatbot test` (or `npx vitest run --config vitest.config.ts` from `apps/chatbot`, matching whatever this app's actual test script is — check `apps/chatbot/package.json`)

Expected: PASS across `conversation.test.ts`, `orchestrator.test.ts`, `sweeper.test.ts`, `ws.test.ts`, `ratelimit.test.ts`, `health.test.ts`, `ingest.test.ts`, `models.test.ts`, `search.test.ts` (the last four untouched by this plan — `models.test.ts`/`search.test.ts` exercise the still-intact, merely-unwired `agent/` and `ingest/` modules directly, not through the orchestrator, so they're unaffected).

- [ ] **Step 3: Fix any stragglers**

If `ratelimit.test.ts` or any of the untouched suites fail, it means a status literal or import was missed elsewhere — grep for it:

```bash
grep -rn "'BOT'\|'PENDING_HUMAN'\|'HUMAN'" apps/chatbot/src apps/chatbot/test apps/api/src apps/admin-web/src apps/catalogues-web/src
```

Every remaining hit should be inside `apps/chatbot/src/conversation/escalation.ts` or the untouched blocks of `apps/chatbot/src/conversation/sweeper.ts` (both intentionally left referencing the legacy values, per the global constraint) — anything outside those two files is a miss to fix.

- [ ] **Step 4: Commit**

```bash
git add -u apps/chatbot/test
git commit -m "test(chatbot): remove bot-turn and availability-escalation tests, now dead paths"
```

---

### Task 15: Full verification pass

**Files:** none modified — this is a verification-only task.

- [ ] **Step 1: Fresh migration check**

```bash
pnpm docker:reset
pnpm docker:up
pnpm db:migrate
```

Expected: all migrations apply cleanly from zero, including `0190_<generated>.sql` from Task 1.

- [ ] **Step 2: Full test suites**

```bash
pnpm --filter @aivastra/chatbot test
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/api test:integration
pnpm --filter @aivastra/types typecheck
```

Expected: all green.

- [ ] **Step 3: Workspace typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: no errors. Pay particular attention to `apps/chatbot/src/conversation/escalation.ts` and the untouched blocks of `sweeper.ts` — confirm they compile against the widened `ConvStatus`/`ConversationStatus` types with zero edits, proving the "hide, don't delete" approach actually held.

- [ ] **Step 4: Manual end-to-end pass**

With `pnpm dev` running: submit a ticket via each of the three entry points (chat bubble, Contact Us, Support modal with an attachment) as one test user; as an admin, confirm all three land as the *same* ticket in the Queue (one active ticket per user, per the spec's core constraint); claim it, exchange messages, resolve it, confirm a new user message reopens it.

- [ ] **Step 5: Report**

Summarize pass/fail for each check above. Do not claim the migration or a route "works" without having actually run it — per this repo's "Report honestly" rule in `CLAUDE.md`.
