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
      .values({
        email: `hitl-user-${Date.now()}-${Math.random()}@x.com`,
        passwordHash: '',
        emailVerified: true,
      })
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
