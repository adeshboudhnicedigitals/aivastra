import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atomicDeduct } from '../../src/modules/credits/ledger.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('unlimited plan', () => {
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
        displayName: 'Unlimited Plan Admin',
        email: 'unlimited-plan-admin@x.com',
        password: 'password123',
      },
    });
    const [adminUser] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'unlimited-plan-admin@x.com'));
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, adminUser.id));
    await app.db.insert(schema.adminUsers).values({
      userId: adminUser.id,
      role: 'SUPER_ADMIN',
      passwordHash: adminUser.passwordHash,
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: 'unlimited-plan-admin@x.com', password: 'password123' },
    });
    adminToken = loginRes.json().accessToken;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  function authed(method: 'GET' | 'POST', url: string, payload?: unknown) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, payload });
  }

  async function seedUser(email: string, balance: number) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, displayName: 'Unlimited Plan Test User', tier: 'free', emailVerified: true })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance });
    return user;
  }

  describe('atomicDeduct bypass', () => {
    it('bypasses the balance check for a user on an active plan, writing a zero-delta ledger row', async () => {
      const user = await seedUser('unlimited-active@x.com', 0);
      await app.db.insert(schema.unlimitedPlans).values({
        userId: user.id,
        startAt: new Date(Date.now() - DAY_MS),
        endAt: new Date(Date.now() + 10 * DAY_MS),
        grantedBy: user.id,
      });

      const jobId = randomUUID();
      const balance = await atomicDeduct(app.db, user.id, 500, jobId);
      expect(balance).toBe(0);

      const [ledgerRow] = await app.db
        .select()
        .from(schema.creditLedger)
        .where(and(eq(schema.creditLedger.userId, user.id), eq(schema.creditLedger.jobId, jobId)));
      expect(ledgerRow?.delta).toBe(0);
      expect(ledgerRow?.reason).toBe('UNLIMITED_PLAN_USAGE');

      const [creditsRow] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, user.id));
      expect(creditsRow?.balance).toBe(0);
    });

    it('still enforces the balance check for a plan whose end date has passed, even if status is stale', async () => {
      const user = await seedUser('unlimited-lapsed@x.com', 0);
      // status is deliberately left 'active' (as if the scheduler hasn't run
      // yet) — enforcement must use the live end date, not trust the column.
      await app.db.insert(schema.unlimitedPlans).values({
        userId: user.id,
        startAt: new Date(Date.now() - 10 * DAY_MS),
        endAt: new Date(Date.now() - DAY_MS),
        grantedBy: user.id,
      });

      await expect(atomicDeduct(app.db, user.id, 5, randomUUID())).rejects.toThrow();
    });

    it('still enforces the balance check for a revoked plan', async () => {
      const user = await seedUser('unlimited-revoked@x.com', 0);
      await app.db.insert(schema.unlimitedPlans).values({
        userId: user.id,
        startAt: new Date(Date.now() - DAY_MS),
        endAt: new Date(Date.now() + DAY_MS),
        status: 'revoked',
        grantedBy: user.id,
      });

      await expect(atomicDeduct(app.db, user.id, 5, randomUUID())).rejects.toThrow();
    });

    it('deducts normally for a user with no unlimited plan', async () => {
      const user = await seedUser('no-unlimited-plan@x.com', 10);
      const balance = await atomicDeduct(app.db, user.id, 3, randomUUID());
      expect(balance).toBe(7);
    });
  });

  describe('GET /v1/credits exposes unlimitedPlan status', () => {
    it('reports status "none" for a user with no plan', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          displayName: 'No Plan',
          email: 'no-plan-credits@x.com',
          password: 'password123',
        },
      });
      await app.db
        .update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.email, 'no-plan-credits@x.com'));
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'no-plan-credits@x.com', password: 'password123' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/credits',
        headers: { authorization: `Bearer ${login.json().accessToken}` },
      });
      expect(res.json().unlimitedPlan.status).toBe('none');
    });

    it('reports status "active" with daysRemaining for a user on an active plan', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          displayName: 'Has Plan',
          email: 'has-plan-credits@x.com',
          password: 'password123',
        },
      });
      const [user] = await app.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'has-plan-credits@x.com'));
      await app.db
        .update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.id, user.id));
      await app.db.insert(schema.unlimitedPlans).values({
        userId: user.id,
        startAt: new Date(Date.now() - DAY_MS),
        endAt: new Date(Date.now() + 10 * DAY_MS),
        grantedBy: user.id,
      });

      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'has-plan-credits@x.com', password: 'password123' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/credits',
        headers: { authorization: `Bearer ${login.json().accessToken}` },
      });
      expect(res.json().unlimitedPlan.status).toBe('active');
      expect(res.json().unlimitedPlan.daysRemaining).toBeGreaterThan(3);
    });
  });

  describe('admin grant/revoke routes', () => {
    it('grants a plan, re-grant while active edits in place, and revoke clears it', async () => {
      const userRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          displayName: 'Admin Managed',
          email: 'admin-managed@x.com',
          password: 'password123',
        },
      });
      void userRes;
      const [user] = await app.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'admin-managed@x.com'));

      const startAt = new Date(Date.now() - DAY_MS).toISOString();
      const firstEndAt = new Date(Date.now() + 5 * DAY_MS).toISOString();
      const grantRes = await authed('POST', `/admin/users/${user.id}/unlimited-plan`, {
        startAt,
        endAt: firstEndAt,
        note: 'negotiated bargain deal',
      });
      expect(grantRes.statusCode).toBe(200);
      expect(grantRes.json().status).toBe('active');

      const secondEndAt = new Date(Date.now() + 20 * DAY_MS).toISOString();
      const extendRes = await authed('POST', `/admin/users/${user.id}/unlimited-plan`, {
        startAt,
        endAt: secondEndAt,
      });
      expect(extendRes.statusCode).toBe(200);

      const rows = await app.db
        .select()
        .from(schema.unlimitedPlans)
        .where(eq(schema.unlimitedPlans.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.endAt.toISOString()).toBe(secondEndAt);
      expect(rows[0]?.lastReminderStage).toBe('none');

      const getRes = await authed('GET', `/admin/users/${user.id}/unlimited-plan`);
      expect(getRes.json().status).toBe('active');

      const revokeRes = await authed('POST', `/admin/users/${user.id}/unlimited-plan/revoke`);
      expect(revokeRes.statusCode).toBe(200);

      const afterRevoke = await authed('GET', `/admin/users/${user.id}/unlimited-plan`);
      expect(afterRevoke.json().status).toBe('none');
    });

    it('persists price and queue priority, and logs a charge for the initial grant and each renewal', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          displayName: 'Priced Plan',
          email: 'priced-plan@x.com',
          password: 'password123',
        },
      });
      const [user] = await app.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'priced-plan@x.com'));

      const startAt = new Date(Date.now() - DAY_MS).toISOString();
      const grantRes = await authed('POST', `/admin/users/${user.id}/unlimited-plan`, {
        startAt,
        endAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        pricePaise: 500000,
        queueStream: 'priority',
      });
      expect(grantRes.json().pricePaise).toBe(500000);
      expect(grantRes.json().queueStream).toBe('priority');

      const renewRes = await authed('POST', `/admin/users/${user.id}/unlimited-plan`, {
        startAt,
        endAt: new Date(Date.now() + 40 * DAY_MS).toISOString(),
        pricePaise: 600000,
        queueStream: 'normal',
      });
      expect(renewRes.json().pricePaise).toBe(600000);
      expect(renewRes.json().queueStream).toBe('normal');

      const getRes = await authed('GET', `/admin/users/${user.id}/unlimited-plan`);
      const charges = getRes.json().charges as { pricePaise: number; chargeType: string }[];
      expect(charges).toHaveLength(2);
      const byType = Object.fromEntries(charges.map((c) => [c.chargeType, c.pricePaise]));
      expect(byType.initial).toBe(500000);
      expect(byType.renewal).toBe(600000);
    });
  });

  describe('resolveQueueRouting with an active unlimited plan', () => {
    it("uses the plan's queueStream instead of the user's tier, with no balance downgrade", async () => {
      const user = await seedUser('unlimited-priority-routing@x.com', 0);
      await app.db.insert(schema.unlimitedPlans).values({
        userId: user.id,
        startAt: new Date(Date.now() - DAY_MS),
        endAt: new Date(Date.now() + 10 * DAY_MS),
        queueStream: 'priority',
        grantedBy: user.id,
      });

      const { resolveQueueRouting } = await import('../../src/modules/jobs/create.js');
      const routing = await resolveQueueRouting(app, user.id);
      expect(routing.queueStream).toBe('priority');
      expect(routing.priority).toBe(true);
    });
  });
});
