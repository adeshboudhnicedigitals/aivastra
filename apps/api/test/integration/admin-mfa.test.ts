import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeAt, stepNow } from '../../src/modules/admin/totp.js';
import { hashPassword } from '../../src/modules/auth/service.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Admin TOTP, option B: gated roles (accounts.read / credits.grant) enrol when enforcement is
// on; anyone enrolled is always challenged.

let c: Containers;
let app: TestApp;
beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    ADMIN_MFA_ENFORCE: true,
    ADMIN_MFA_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

let n = 0;
async function makeAdmin(role: 'ADMIN' | 'SUPPORT' | 'SUPER_ADMIN') {
  const email = `mfa-${Date.now()}-${n++}@x.com`;
  const passwordHash = await hashPassword('password123');
  const [u] = await app.db
    .insert(schema.users)
    .values({ email, passwordHash, displayName: 'MFA', emailVerified: true })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: (u as { id: string }).id, balance: 0 });
  await app.db
    .insert(schema.adminUsers)
    .values({ userId: (u as { id: string }).id, role, status: 'active', passwordHash });
  return { email, userId: (u as { id: string }).id, ip: `198.51.100.${(n % 250) + 1}` };
}

const post = (url: string, payload: unknown, ip: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers, remoteAddress: ip });
const login = (a: { email: string; ip: string }) =>
  post('/admin/auth/login', { email: a.email, password: 'password123' }, a.ip);

async function enrol(a: { email: string; ip: string }) {
  const l = (await login(a)).json();
  const start = (await post('/admin/auth/mfa/enroll/start', { mfaToken: l.mfaToken }, a.ip)).json();
  const res = await post(
    '/admin/auth/mfa/enroll/confirm',
    { mfaToken: l.mfaToken, code: codeAt(start.secret, stepNow()) },
    a.ip,
  );
  return { secret: start.secret as string, res };
}

describe('admin MFA', () => {
  it('a gated role must enrol: no session until a code proves the authenticator', async () => {
    const a = await makeAdmin('ADMIN');
    const res = await login(a);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mfaRequired).toBe('enroll');
    expect(body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    // The step token is not an access token anywhere.
    const probe = await app.inject({
      method: 'GET',
      url: '/admin/accounts',
      headers: { authorization: `Bearer ${body.mfaToken}` },
    });
    expect(probe.statusCode).toBe(401);

    const start = (
      await post('/admin/auth/mfa/enroll/start', { mfaToken: body.mfaToken }, a.ip)
    ).json();
    expect(start.otpauthUri).toContain('otpauth://totp/');
    const wrong = await post(
      '/admin/auth/mfa/enroll/confirm',
      { mfaToken: body.mfaToken, code: '000000' },
      a.ip,
    );
    expect(wrong.statusCode).toBe(401);

    const ok = await post(
      '/admin/auth/mfa/enroll/confirm',
      { mfaToken: body.mfaToken, code: codeAt(start.secret, stepNow()) },
      a.ip,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();
    expect(ok.json().recoveryCodes).toHaveLength(8);
    expect(String(ok.headers['set-cookie'])).toContain('refresh=');

    const [row] = await app.db
      .select({ enc: schema.adminUsers.totpSecretEnc })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, a.userId));
    expect(row?.enc).toBeTruthy();
    expect(row?.enc).not.toContain(start.secret); // sealed, not stored in the clear
  });

  it('an enrolled admin is challenged; a used code cannot be replayed', async () => {
    const a = await makeAdmin('ADMIN');
    const { secret } = await enrol(a);
    const l = (await login(a)).json();
    expect(l.mfaRequired).toBe('verify');
    expect(l.accessToken).toBeUndefined();

    // Enrolment used the current step, so the same code is a replay.
    const replay = await post(
      '/admin/auth/mfa/verify',
      { mfaToken: l.mfaToken, code: codeAt(secret, stepNow()) },
      a.ip,
    );
    expect(replay.statusCode).toBe(401);

    const next = await post(
      '/admin/auth/mfa/verify',
      { mfaToken: l.mfaToken, code: codeAt(secret, stepNow() + 1) },
      a.ip,
    );
    expect(next.statusCode).toBe(200);
    expect(next.json().accessToken).toBeTruthy();
  });

  it('a recovery code works exactly once', async () => {
    const a = await makeAdmin('ADMIN');
    const { res } = await enrol(a);
    const code = res.json().recoveryCodes[0] as string;
    const l1 = (await login(a)).json();
    expect(
      (await post('/admin/auth/mfa/verify', { mfaToken: l1.mfaToken, recoveryCode: code }, a.ip))
        .statusCode,
    ).toBe(200);
    const l2 = (await login(a)).json();
    expect(
      (await post('/admin/auth/mfa/verify', { mfaToken: l2.mfaToken, recoveryCode: code }, a.ip))
        .statusCode,
    ).toBe(401);
  });

  it('locks after repeated wrong codes', async () => {
    const a = await makeAdmin('ADMIN');
    await enrol(a);
    const l = (await login(a)).json();
    for (let i = 0; i < 5; i++) {
      await post('/admin/auth/mfa/verify', { mfaToken: l.mfaToken, code: '111111' }, a.ip);
    }
    const locked = await post(
      '/admin/auth/mfa/verify',
      { mfaToken: l.mfaToken, code: '111111' },
      a.ip,
    );
    expect(locked.statusCode).toBe(429);
  });

  it('a role without accounts.read or credits.grant is not forced to enrol', async () => {
    const a = await makeAdmin('SUPPORT');
    const res = await login(a);
    expect(res.json().accessToken).toBeTruthy();
    expect(res.json().mfaRequired).toBeUndefined();
  });

  it('only SUPER_ADMIN can reset a factor, and the person must re-enrol', async () => {
    const a = await makeAdmin('ADMIN');
    await enrol(a);
    const adminHdr = await adminAuthHeader(app, 'ADMIN');
    const denied = await post(`/admin/users/${a.userId}/mfa/reset`, {}, '198.51.100.201', adminHdr);
    expect(denied.statusCode).toBe(403);
    const superHdr = await adminAuthHeader(app, 'SUPER_ADMIN');
    const ok = await post(`/admin/users/${a.userId}/mfa/reset`, {}, '198.51.100.202', superHdr);
    expect(ok.statusCode).toBe(200);
    expect((await login(a)).json().mfaRequired).toBe('enroll');
  });
});
