import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('signup-campaigns admin CRUD', () => {
  let c: Containers;
  let app: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        displayName: 'Campaigns Admin',
        email: 'campaigns-admin@x.com',
        password: 'password123',
      },
    });
    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'campaigns-admin@x.com'));
    const userId = user?.id;
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, userId));
    await app.db.insert(schema.adminUsers).values({
      userId,
      role: 'SUPER_ADMIN',
      passwordHash: user?.passwordHash,
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: 'campaigns-admin@x.com', password: 'password123' },
    });
    adminToken = loginRes.json().accessToken;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  function authed(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });
  }

  it('creates, lists, updates, and deletes a campaign', async () => {
    const created = await authed('POST', '/admin/signup-campaigns', {
      code: 'crud-test-1',
      name: 'CRUD Test Campaign',
      bonusPercent: 25,
      startAt: '2026-08-06T00:00:00.000Z',
      endAt: '2026-08-08T23:59:59.000Z',
      isActive: true,
    });
    expect(created.statusCode).toBe(200);
    const campaign = created.json();
    expect(campaign.code).toBe('crud-test-1');
    expect(campaign.bonusPercent).toBe(25);

    const list = await authed('GET', '/admin/signup-campaigns');
    expect(list.statusCode).toBe(200);
    expect(list.json().some((c: { id: string }) => c.id === campaign.id)).toBe(true);

    const updated = await authed('PATCH', `/admin/signup-campaigns/${campaign.id}`, {
      bonusPercent: 30,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().bonusPercent).toBe(30);

    const deleted = await authed('DELETE', `/admin/signup-campaigns/${campaign.id}`);
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects a window where endAt is before startAt (400)', async () => {
    const res = await authed('POST', '/admin/signup-campaigns', {
      code: 'bad-window',
      name: 'Bad Window',
      bonusPercent: 25,
      startAt: '2026-08-08T00:00:00.000Z',
      endAt: '2026-08-06T00:00:00.000Z',
      isActive: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks deleting a campaign that a user is attributed to (409)', async () => {
    const created = await authed('POST', '/admin/signup-campaigns', {
      code: 'attributed-delete-test',
      name: 'Attributed Delete Test',
      bonusPercent: 25,
      startAt: '2026-08-06T00:00:00.000Z',
      endAt: '2026-08-08T23:59:59.000Z',
      isActive: true,
    });
    const campaign = created.json();

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        displayName: 'Attributed User',
        email: 'attributed-delete-user@x.com',
        password: 'password123',
      },
    });
    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'attributed-delete-user@x.com'));
    await app.db
      .update(schema.users)
      .set({ signupCampaignId: campaign.id })
      .where(eq(schema.users.id, user?.id));

    const delRes = await authed('DELETE', `/admin/signup-campaigns/${campaign.id}`);
    expect(delRes.statusCode).toBe(409);
  });

  it('serializes concurrent partial window updates', async () => {
    const created = await authed('POST', '/admin/signup-campaigns', {
      code: 'concurrent-window-test',
      name: 'Concurrent Window Test',
      bonusPercent: 25,
      startAt: '2026-08-06T00:00:00.000Z',
      endAt: '2026-08-08T00:00:00.000Z',
      isActive: true,
    });
    const campaign = created.json();
    const locker = postgres(c.pgUrl, { max: 1 });

    try {
      let updates: [ReturnType<typeof authed>, ReturnType<typeof authed>] | undefined;
      await locker.begin(async (tx) => {
        await tx`select id from signup_campaigns where id = ${campaign.id} for update`;
        updates = [
          authed('PATCH', `/admin/signup-campaigns/${campaign.id}`, {
            startAt: '2026-08-07T00:00:00.000Z',
          }),
          authed('PATCH', `/admin/signup-campaigns/${campaign.id}`, {
            endAt: '2026-08-07T00:00:00.000Z',
          }),
        ];
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      if (!updates) throw new Error('concurrent updates did not start');
      const results = await Promise.all(updates);
      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 400]);
      const [stored] = await app.db
        .select()
        .from(schema.signupCampaigns)
        .where(eq(schema.signupCampaigns.id, campaign.id));
      expect(stored?.endAt.getTime()).toBeGreaterThan(stored?.startAt.getTime() ?? 0);
    } finally {
      await locker.end();
    }
  });
});
