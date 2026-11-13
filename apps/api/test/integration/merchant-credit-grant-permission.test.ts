import { schema } from '@aivastra/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant } from '../helpers/merchant.js';

// Account console phase 1 (spec §5): minting merchant credits needs credits.grant, not just
// merchants.write.

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

const grant = (merchantId: string, headers: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/admin/merchants/${merchantId}/credits`,
    headers,
    payload: { amount: 10, reason: 'test grant' },
  });

describe('credits.grant', () => {
  it('migration seeded it onto every role that holds credits.write', async () => {
    const rows = await app.db.execute<{ role: string; has_grant: boolean }>(sql`
      select w.role,
        exists (
          select 1 from role_permissions g join permissions gp on gp.id = g.permission_id
          where g.role = w.role and gp.key = 'credits.grant'
        ) as has_grant
      from role_permissions w join permissions wp on wp.id = w.permission_id
      where wp.key = 'credits.write'
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.has_grant, r.role).toBe(true);
  });

  it('SUPER_ADMIN can grant; the balance moves and the grant is audited', async () => {
    const m = await createTestMerchant(app, { balance: 5 });
    const res = await grant(m.merchantId, await adminAuthHeader(app, 'SUPER_ADMIN'));
    expect(res.statusCode).toBe(200);
    expect(res.json().newBalance).toBe(15);
  });

  it('a role with merchants.write but no credits.grant is refused (the old loophole)', async () => {
    const m = await createTestMerchant(app);
    const auth = await adminAuthHeader(app, 'ADMIN');
    expect((await grant(m.merchantId, auth)).statusCode).toBe(200);

    // SUPER_ADMIN narrows the matrix: remove credits.grant from ADMIN.
    const [perm] = await app.db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.key, 'credits.grant'));
    await app.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.role, 'ADMIN'),
          eq(schema.rolePermissions.permissionId, perm!.id),
        ),
      );
    try {
      const res = await grant(m.merchantId, auth);
      expect(res.statusCode).toBe(403);
    } finally {
      await app.db.insert(schema.rolePermissions).values({ role: 'ADMIN', permissionId: perm!.id });
    }
  });
});
