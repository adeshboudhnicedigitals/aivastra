import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { ensureMerchantForUser } from '../../src/modules/merchant/wordpress-shared.js';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestMerchant, createTestStaff } from '../helpers/merchant';

// A user who is already a merchant staff member must not also become a merchant
// owner: requireMerchantMember would resolve them as owner and silently drop the
// branch-scoped staff role. All three creation paths refuse with the same 409.
const STAFF_MSG =
  'this account is a staff member of a merchant; remove it from staff before creating a merchant';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function staffUser(opts: { isActive?: boolean } = {}) {
  const m = await createTestMerchant(app);
  const b = await createTestBranch(app, m.merchantId);
  return createTestStaff(app, m.merchantId, b.id, opts);
}

async function plainUser() {
  const [u] = await app.db
    .insert(schema.users)
    .values({ email: `plain-${randomUUID()}@test.com`, displayName: 'Plain', emailVerified: true })
    .returning();
  return u!;
}

const merchantCount = async (userId: string) =>
  (await app.db.select().from(schema.merchants).where(eq(schema.merchants.userId, userId))).length;

async function deviceToken(userId: string) {
  return signAccess(
    new TextEncoder().encode(app.env.JWT_SECRET),
    userId,
    { kind: 'access' },
    app.env.JWT_EXPIRY,
    'device',
  );
}

describe('merchant creation refuses staff accounts', () => {
  it('ensureMerchantForUser (WordPress paths): staff 409, normal user creates', async () => {
    for (const isActive of [true, false]) {
      const s = await staffUser({ isActive });
      await expect(
        app.db.transaction((tx) => ensureMerchantForUser(tx, s.userId, {})),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: STAFF_MSG,
      });
      expect(await merchantCount(s.userId)).toBe(0);
    }
    const u = await plainUser();
    const r = await app.db.transaction((tx) => ensureMerchantForUser(tx, u.id, {}));
    expect(r.created).toBe(true);
  });

  it('POST /v1/merchant/onboarding: staff 409, normal user 201', async () => {
    const s = await staffUser();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: { authorization: `Bearer ${await deviceToken(s.userId)}` },
      payload: { phone: '9876543210' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe(STAFF_MSG);
    expect(await merchantCount(s.userId)).toBe(0);

    const u = await plainUser();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: { authorization: `Bearer ${await deviceToken(u.id)}` },
      payload: { phone: '9876543210' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('POST /admin/merchants: staff 409 by userId and by email, normal user 201', async () => {
    const headers = await adminAuthHeader(app);
    const s = await staffUser({ isActive: false });
    const [su] = await app.db.select().from(schema.users).where(eq(schema.users.id, s.userId));

    const byId = await app.inject({
      method: 'POST',
      url: '/admin/merchants',
      headers,
      payload: { userId: s.userId, companyName: 'X' },
    });
    expect(byId.statusCode).toBe(409);
    expect(byId.json().error.message).toBe(STAFF_MSG);
    const byEmail = await app.inject({
      method: 'POST',
      url: '/admin/merchants',
      headers,
      payload: { email: su!.email, companyName: 'X' },
    });
    expect(byEmail.statusCode).toBe(409);
    expect(await merchantCount(s.userId)).toBe(0);

    const u = await plainUser();
    const ok = await app.inject({
      method: 'POST',
      url: '/admin/merchants',
      headers,
      payload: { userId: u.id, companyName: 'Fine' },
    });
    expect(ok.statusCode).toBe(201);
  });
});
