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

  it('handleUserMessage passes an attachmentType through to the stored message', async () => {
    const orchestrator = new Orchestrator(t.deps);
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await orchestrator.handleUserMessage(
      conv.id,
      userId,
      'invoice attached',
      'support/xyz.pdf',
      'application/pdf',
    );

    const rows = await t.deps.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, conv.id))
      .orderBy(schema.chatbotMessages.createdAt);
    const last = rows[rows.length - 1];
    expect(last?.attachmentType).toBe('application/pdf');
  });

  it('derives the ticket subject from the first user message and leaves it alone after', async () => {
    const orchestrator = new Orchestrator(t.deps);
    const [fresh] = await t.deps.db
      .insert(schema.users)
      .values({
        email: `orch-subj-${crypto.randomUUID()}@test.dev`,
        passwordHash: 'x',
        emailVerified: true,
      })
      .returning();
    const conv = await getOrCreateActiveConversation(t.deps.db, fresh.id);
    expect(conv.created).toBe(true);

    const long = `My payment failed twice today ${'and I still got charged '.repeat(6)}`;
    await orchestrator.handleUserMessage(conv.id, fresh.id, long);

    const [afterFirst] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(afterFirst?.subject).toBe(long.trim().slice(0, 80));
    expect(afterFirst?.subject?.length).toBe(80);

    await orchestrator.handleUserMessage(conv.id, fresh.id, 'a follow-up message');
    const [afterSecond] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(afterSecond?.subject).toBe(afterFirst?.subject);
  });

  it('reports created=false when resuming an existing ticket', async () => {
    const [fresh] = await t.deps.db
      .insert(schema.users)
      .values({
        email: `orch-resume-${crypto.randomUUID()}@test.dev`,
        passwordHash: 'x',
        emailVerified: true,
      })
      .returning();
    const first = await getOrCreateActiveConversation(t.deps.db, fresh.id);
    expect(first.created).toBe(true);
    const second = await getOrCreateActiveConversation(t.deps.db, fresh.id);
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });
});
