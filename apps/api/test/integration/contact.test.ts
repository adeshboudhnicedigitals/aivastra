import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/v1/contact writes a ticket', () => {
  let c: Containers;
  let app: TestApp;
  let userToken: string;
  let userId: string;

  const form = (over: Record<string, unknown> = {}) => ({
    name: 'Test User',
    email: 'test@example.com',
    phone: '9999999999',
    source: 'contact-us',
    ...over,
  });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const passwordHash = await hashPassword('password123');
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: 'contact-user@x.com', passwordHash, emailVerified: true })
      .returning();
    userId = u.id;
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

  // /v1/contact shares the WS path's per-user counter (chatbot:rl:{userId}, 10 per
  // 30s), and every test here posts as the same user — clear it so unrelated tests
  // can't trip the limit, and so the rate-limit test below starts from zero.
  beforeEach(async () => {
    await app.redis.del(`chatbot:rl:${userId}`);
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
    // subject is derived from the first user message so the agent queue is triageable
    expect(conv?.subject).toBe('Question about pricing');
  });

  it('derives a truncated subject and leaves it alone on later messages', async () => {
    const [fresh] = await app.db
      .insert(schema.users)
      .values({
        email: `contact-subj-${randomUUID()}@x.com`,
        passwordHash: await hashPassword('password123'),
        emailVerified: true,
      })
      .returning();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '192.0.2.21',
      payload: { email: fresh.email, password: 'password123' },
    });
    const token = login.json().accessToken;

    const long = `Pricing question ${'about the annual plan and taxes '.repeat(6)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${token}` },
      payload: form({ message: long }),
    });
    const { ticketId } = first.json() as { ticketId: string };
    const [afterFirst] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(afterFirst?.subject).toBe(long.trim().slice(0, 80));
    expect(afterFirst?.subject?.length).toBe(80);

    await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${token}` },
      payload: form({ message: 'any update?' }),
    });
    const [afterSecond] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(afterSecond?.subject).toBe(afterFirst?.subject);
  });

  it('a message to a RESOLVED ticket reopens it to OPEN, clears the agent, logs a reopen event', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: form({ message: 'first' }),
    });
    const { ticketId } = first.json() as { ticketId: string };
    await app.db
      .update(schema.chatbotConversations)
      .set({ status: 'RESOLVED', assignedAgentId: null })
      .where(eq(schema.chatbotConversations.id, ticketId));

    await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: form({ message: 'reopening this' }),
    });

    const [conv] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(conv?.status).toBe('OPEN');
    expect(conv?.assignedAgentId).toBeNull();
    const events = await app.db
      .select()
      .from(schema.chatbotEvents)
      .where(
        and(
          eq(schema.chatbotEvents.conversationId, ticketId),
          eq(schema.chatbotEvents.type, 'reopen'),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.fromStatus).toBe('RESOLVED');
    expect(events[0]?.toStatus).toBe('OPEN');
  });

  it('rejects an 11th submit inside the 30s window with a 429', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await app.inject({
        method: 'POST',
        url: '/v1/contact',
        headers: { authorization: `Bearer ${userToken}` },
        payload: form({ message: `burst ${i}` }),
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: form({ message: 'one too many' }),
    });
    expect(limited.statusCode).toBe(429);
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

  it('still returns 200 and stores the message even when the acknowledgment email send fails', async () => {
    // The test harness has no real Resend credentials configured, so
    // sendReportReceivedEmail is expected to throw here — this asserts that
    // failure is swallowed (try/catch around the send) and never fails the
    // request, matching the original contact_requests-era handler's behavior.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        source: 'contact-us',
        message: 'email send should not block this',
      },
    });
    expect(res.statusCode).toBe(200);
    const { ticketId } = res.json() as { ticketId: string };
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId))
      .orderBy(schema.chatbotMessages.createdAt);
    expect(msgs[msgs.length - 1]?.content).toBe('email send should not block this');
  });
});
