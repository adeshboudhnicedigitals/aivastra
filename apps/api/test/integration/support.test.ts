import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/v1/support writes a ticket', () => {
  let c: Containers;
  let app: TestApp;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const passwordHash = await hashPassword('password123');
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: 'support-user@x.com', passwordHash, emailVerified: true })
      .returning();
    userId = u.id;
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

  // /v1/support shares the WS path's per-user counter (chatbot:rl:{userId}, 10 per
  // 30s), and every test here posts as the same user — clear it so unrelated tests
  // can't trip the limit, and so the rate-limit test below starts from zero.
  beforeEach(async () => {
    await app.redis.del(`chatbot:rl:${userId}`);
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
    // subject is derived from the first user message so the agent queue is triageable
    expect(conv?.subject).toBe('My order looks wrong');
  });

  it('derives a truncated subject and leaves it alone on later messages', async () => {
    const [fresh] = await app.db
      .insert(schema.users)
      .values({
        email: `support-subj-${randomUUID()}@x.com`,
        passwordHash: await hashPassword('password123'),
        emailVerified: true,
      })
      .returning();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '192.0.2.11',
      payload: { email: fresh.email, password: 'password123' },
    });
    const token = login.json().accessToken;

    const long = `Refund never arrived ${'and support has not replied '.repeat(6)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: long },
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
      url: '/v1/support',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'any update?' },
    });
    const [afterSecond] = await app.db
      .select()
      .from(schema.chatbotConversations)
      .where(eq(schema.chatbotConversations.id, ticketId));
    expect(afterSecond?.subject).toBe(afterFirst?.subject);
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

  it('passes attachmentKey and attachmentType through to the stored message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        message: 'see photo',
        attachmentKey: 'support/xyz.jpg',
        attachmentType: 'image/jpeg',
      },
    });
    const { ticketId } = res.json() as { ticketId: string };
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId))
      .orderBy(schema.chatbotMessages.createdAt);
    expect(msgs[msgs.length - 1]?.attachmentKey).toBe('support/xyz.jpg');
    expect(msgs[msgs.length - 1]?.attachmentType).toBe('image/jpeg');
  });

  it('stores a non-image attachmentType verbatim', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        message: 'invoice attached',
        attachmentKey: 'support/abc.pdf',
        attachmentType: 'application/pdf',
      },
    });
    const { ticketId } = res.json() as { ticketId: string };
    const msgs = await app.db
      .select()
      .from(schema.chatbotMessages)
      .where(eq(schema.chatbotMessages.conversationId, ticketId))
      .orderBy(schema.chatbotMessages.createdAt);
    expect(msgs[msgs.length - 1]?.attachmentType).toBe('application/pdf');
  });

  it('rejects an 11th submit inside the 30s window with a 429', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await app.inject({
        method: 'POST',
        url: '/v1/support',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { message: `burst ${i}` },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'one too many' },
    });
    expect(limited.statusCode).toBe(429);
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
    expect(conv?.assignedAgentId).toBeNull();
    // the reopen must leave the same audit trail apps/chatbot's reopenIfResolved does
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

  it('still returns 200 and stores the message even when the acknowledgment email send fails', async () => {
    // The test harness has no real Resend credentials configured, so
    // sendReportReceivedEmail is expected to throw here — this asserts that
    // failure is swallowed (try/catch around the send) and never fails the
    // request, matching the original contact_requests-era handler's behavior.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/support',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { message: 'email send should not block this' },
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

  describe('GET /v1/support/attachment', () => {
    // Deliberately unauthenticated: an <img> tag can't carry a bearer header,
    // and this codebase forbids auth tokens in the query string (see the route's
    // own comment). The key itself — a randomUUID()-derived support/ path minted
    // by POST /v1/support/presign — is the capability. presignGet only signs a
    // URL; it never checks the object exists, so no real MinIO object is needed
    // for these assertions.
    it('redirects with no Authorization header for a well-formed support/ key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/support/attachment?key=${encodeURIComponent(`support/${randomUUID()}.jpg`)}`,
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBeTruthy();
    });

    it('404s a support/ key that is not the shape keys.supportAttachment mints', async () => {
      for (const key of [
        'support/xyz.jpg',
        `support/${randomUUID()}.exe`,
        `support/nested/${randomUUID()}.jpg`,
        `support/../outputs/${randomUUID()}.png`,
      ]) {
        const res = await app.inject({
          method: 'GET',
          url: `/v1/support/attachment?key=${encodeURIComponent(key)}`,
        });
        expect(res.statusCode, key).toBe(404);
      }
    });

    it('serves a pdf attachment key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/support/attachment?key=${encodeURIComponent(`support/${randomUUID()}.pdf`)}`,
      });
      expect(res.statusCode).toBe(302);
    });

    it('404s a key outside the support/ prefix, even with no auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/support/attachment?key=outputs%2Fsome-job%2Fresult.png',
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s a key outside the support/ prefix even when a valid Authorization header is present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/support/attachment?key=invoices%2Fsome-payment.pdf',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
