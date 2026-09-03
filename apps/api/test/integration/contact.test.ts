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
