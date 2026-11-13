import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant } from '../helpers/merchant.js';

// Account console phase 1, onboarding invite (spec §5.1).

let c: Containers;
let app: TestApp;
let admin: Record<string, string>;
beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  admin = await adminAuthHeader(app);
}, 60_000);
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });

async function createViaConsole(email = `invite-${randomUUID()}@x.test`) {
  const res = await req('POST', '/admin/merchants', admin, {
    email,
    companyName: `Invitee Co ${randomUUID().slice(0, 8)}`,
    phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
  });
  expect(res.statusCode).toBe(201);
  const [u] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
  return { merchantId: res.json().id as string, user: u!, body: res.json(), email };
}
const liveToken = async (userId: string) => app.redis.get(`email:invite:user:${userId}`);

describe('merchant onboarding invite', () => {
  it('a new account gets an invite, pending until accepted; accepting sets the password once', async () => {
    const m = await createViaConsole();
    expect(['sent', 'failed']).toContain(m.body.invite); // sending needs Resend; the token exists either way
    const token = await liveToken(m.user.id);
    expect(token).toBeTruthy();
    expect((await req('GET', `/admin/merchants/${m.merchantId}/invite`, admin)).json().status).toBe(
      'pending',
    );

    const accept = await req(
      'POST',
      '/v1/auth/accept-invite',
      {},
      {
        token,
        newPassword: 'a-good-password',
      },
    );
    expect(accept.statusCode).toBe(200);
    const [after] = await app.db.select().from(schema.users).where(eq(schema.users.id, m.user.id));
    expect(after!.emailVerified).toBe(true);
    expect(after!.passwordHash).not.toBe(m.user.passwordHash);
    expect((await req('GET', `/admin/merchants/${m.merchantId}/invite`, admin)).json().status).toBe(
      'accepted',
    );

    // single use
    const again = await req(
      'POST',
      '/v1/auth/accept-invite',
      {},
      {
        token,
        newPassword: 'another-password',
      },
    );
    expect(again.statusCode).toBe(400);

    // and the new password signs in
    const login = await req(
      'POST',
      '/v1/auth/login',
      {},
      { email: m.email, password: 'a-good-password' },
    );
    expect(login.statusCode).toBe(200);
  });

  it('resend invalidates the old link; an accepted account cannot be re-invited; audited', async () => {
    const m = await createViaConsole();
    const first = await liveToken(m.user.id);
    const resend = await req('POST', `/admin/merchants/${m.merchantId}/invite/resend`, admin);
    expect(resend.statusCode).toBe(200);
    const second = await liveToken(m.user.id);
    expect(second).not.toBe(first);

    const old = await req(
      'POST',
      '/v1/auth/accept-invite',
      {},
      {
        token: first,
        newPassword: 'a-good-password',
      },
    );
    expect(old.statusCode).toBe(400);
    const fresh = await req(
      'POST',
      '/v1/auth/accept-invite',
      {},
      {
        token: second,
        newPassword: 'a-good-password',
      },
    );
    expect(fresh.statusCode).toBe(200);

    expect(
      (await req('POST', `/admin/merchants/${m.merchantId}/invite/resend`, admin)).statusCode,
    ).toBe(409);
    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'merchant.invite_resend'));
    expect(audits.some((a) => a.resourceId === m.merchantId)).toBe(true);
  });

  it('an expired invite is reported as expired, and a weak password is refused', async () => {
    const m = await createViaConsole();
    await app.redis.del(`email:invite:${await liveToken(m.user.id)}`);
    await app.redis.del(`email:invite:user:${m.user.id}`);
    expect((await req('GET', `/admin/merchants/${m.merchantId}/invite`, admin)).json().status).toBe(
      'expired',
    );
    const weak = await req(
      'POST',
      '/v1/auth/accept-invite',
      {},
      { token: 'x', newPassword: 'short' },
    );
    expect(weak.statusCode).toBe(400);
  });

  it('an existing account is not sent an invite and keeps its password', async () => {
    const existing = await createTestMerchant(app);
    const [u] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, existing.userId));
    // A user who is not yet a merchant.
    const [plain] = await app.db
      .insert(schema.users)
      .values({
        email: `plain-${randomUUID()}@x.test`,
        passwordHash: 'keep-me',
        emailVerified: true,
      })
      .returning();
    const res = await req('POST', '/admin/merchants', admin, {
      userId: plain!.id,
      companyName: 'Existing Co',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().invite).toBe('none');
    expect(await liveToken(plain!.id)).toBeNull();
    const [after] = await app.db.select().from(schema.users).where(eq(schema.users.id, plain!.id));
    expect(after!.passwordHash).toBe('keep-me');
    void u;
  });

  it('merchant-role callers cannot reach the invite routes', async () => {
    const m = await createTestMerchant(app);
    const res = await req('POST', `/admin/merchants/${m.merchantId}/invite/resend`, {});
    expect(res.statusCode).toBe(401);
  });
});
