import { createHash, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

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

async function setup() {
  const m = await createTestMerchant(app);
  const b = await createTestBranch(app, m.merchantId);
  const s = await createTestStaff(app, m.merchantId, b.id);
  await app.db
    .update(schema.users)
    .set({ passwordHash: await hashPassword('old-password-1') })
    .where(eq(schema.users.id, s.userId));
  const [u] = await app.db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  return { m, b, s, email: u!.email as string, admin: await memberAuthHeader(app, m.userId) };
}

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

describe('merchant admin — staff password reset', () => {
  it('resets the password: new works, old fails, sessions revoked', async () => {
    const { s, email, admin } = await setup();
    expect((await login(email, 'old-password-1')).statusCode).toBe(200);
    const [tok] = await app.db
      .insert(schema.refreshTokens)
      .values({
        userId: s.userId,
        familyId: randomUUID(),
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/staff/${s.staffId}/password`,
      headers: admin,
      payload: { password: 'new-password-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await login(email, 'new-password-2')).statusCode).toBe(200);
    expect((await login(email, 'old-password-1')).statusCode).toBeGreaterThanOrEqual(400);

    const [after] = await app.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, tok!.id));
    expect(after!.revokedAt).not.toBeNull();
  });

  it('rejects a staff caller', async () => {
    const { s } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/staff/${s.staffId}/password`,
      headers: s.auth,
      payload: { password: 'new-password-2' },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s for another merchant's staff and leaves the password unchanged", async () => {
    const { s, email } = await setup();
    const other = await createTestMerchant(app);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/staff/${s.staffId}/password`,
      headers: await memberAuthHeader(app, other.userId),
      payload: { password: 'new-password-2' },
    });
    expect(res.statusCode).toBe(404);
    expect((await login(email, 'old-password-1')).statusCode).toBe(200);
  });

  it('audits without the password or hash', async () => {
    const { s, admin } = await setup();
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/staff/${s.staffId}/password`,
      headers: admin,
      payload: { password: 'new-password-2' },
    });
    const rows = await app.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'merchant_staff.password_reset'),
          eq(schema.auditLogs.resourceId, s.staffId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorRole).toBe('MERCHANT_ADMIN');
    const json = JSON.stringify(rows[0]!.after ?? {});
    expect(json).not.toContain('new-password-2');
    expect(json).not.toMatch(/argon|\$2[aby]\$|hash/i);
  });

  it('rejects a 7-character password', async () => {
    const { s, admin } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/merchant/org/staff/${s.staffId}/password`,
      headers: admin,
      payload: { password: '1234567' },
    });
    expect(res.statusCode).toBe(400);
  });
});
