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
    it('redirects with no Authorization header for a support/ key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/support/attachment?key=support%2Fxyz.jpg',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBeTruthy();
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
