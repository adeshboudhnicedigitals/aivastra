import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOrCreateActiveConversation } from '../src/conversation/service.js';
import { runChatSweeper } from '../src/conversation/sweeper.js';
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

  it('closes a RESOLVED ticket once it has been idle past the resolved-close timeout', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    const staleCutoff = new Date(
      Date.now() - (t.deps.env.CHATBOT_RESOLVED_CLOSE_TIMEOUT_MIN + 1) * 60_000,
    );
    await t.deps.db
      .update(schema.chatbotConversations)
      .set({ status: 'RESOLVED', lastMessageAt: staleCutoff })
      .where(eq(schema.chatbotConversations.id, conv.id));

    await runChatSweeper(t.deps);

    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('CLOSED');
    expect(row?.closedAt).not.toBeNull();
  });

  it('leaves a RESOLVED ticket alone while still inside the resolved-close timeout', async () => {
    const conv = await getOrCreateActiveConversation(t.deps.db, userId);
    await t.deps.db
      .update(schema.chatbotConversations)
      .set({ status: 'RESOLVED', lastMessageAt: new Date() })
      .where(eq(schema.chatbotConversations.id, conv.id));

    await runChatSweeper(t.deps);

    const [row] = await t.deps.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, conv.id));
    expect(row?.status).toBe('RESOLVED');
  });
});
