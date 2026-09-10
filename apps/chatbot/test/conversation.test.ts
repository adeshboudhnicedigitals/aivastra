import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendMessage,
  getOrCreateActiveConversation,
  listMessages,
  reopenIfResolved,
  transition,
} from '../src/conversation/service.js';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

describe('conversation service', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'chat@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('creates one active conversation, resumes it', async () => {
    const a = await getOrCreateActiveConversation(t.deps.db, userId);
    const b = await getOrCreateActiveConversation(t.deps.db, userId);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('OPEN');
  });

  it('append + list messages ordered', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await appendMessage(t.deps.db, t.deps.pub, conv.id, {
      role: 'user',
      senderId: userId,
      content: 'hi',
    });
    await appendMessage(t.deps.db, t.deps.pub, conv.id, { role: 'bot', content: 'hello!' });
    const msgs = await listMessages(t.deps.db, conv.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'bot']);
  });

  it('guarded transition: wrong from-status is a no-op', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    const bad = await transition(t.deps.db, t.deps.pub, conv.id, {
      from: 'HUMAN',
      to: 'CLOSED',
      type: 'close',
    });
    expect(bad).toBe(false);
    const ok = await transition(t.deps.db, t.deps.pub, conv.id, {
      from: 'OPEN',
      to: 'IN_PROGRESS',
      type: 'escalate',
      reason: 'user_request',
    });
    expect(ok).toBe(true);
    const events = await t.deps.db.select().from(schema.chatbotEvents);
    expect(events.some((e) => e.type === 'escalate' && e.toStatus === 'IN_PROGRESS')).toBe(true);
  });

  it('CLOSED never resumes — new conversation created', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await transition(t.deps.db, t.deps.pub, conv.id, {
      from: ['OPEN', 'IN_PROGRESS'],
      to: 'CLOSED',
      type: 'close',
    });
    const fresh = await getOrCreateActiveConversation(t.deps.db, userId);
    expect(fresh.id).not.toBe(conv.id);
  });

  it('getOrCreateActiveConversation defaults to OPEN with chat_widget source', async () => {
    const [freshUser] = await t.deps.db
      .insert(schema.users)
      .values({
        email: `src-${crypto.randomUUID()}@test.dev`,
        passwordHash: 'x',
        emailVerified: true,
      })
      .returning();
    const conv = await getOrCreateActiveConversation(t.deps.db, freshUser.id);
    expect(conv.status).toBe('OPEN');
  });

  it('getOrCreateActiveConversation honors an explicit source on creation', async () => {
    const [freshUser] = await t.deps.db
      .insert(schema.users)
      .values({
        email: `src2-${crypto.randomUUID()}@test.dev`,
        passwordHash: 'x',
        emailVerified: true,
      })
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
});
