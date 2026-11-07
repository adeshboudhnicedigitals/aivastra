import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  // Probe route registered before listen: it exercises requireMerchantTeam in isolation
  // until a real catalogue route is switched to it.
  app = await buildTestApp(
    c,
    {},
    {
      beforeListen: (a) => {
        a.get('/__team', { preHandler: a.requireMerchantTeam }, async (req) => ({
          id: req.merchantClientId,
        }));
      },
    },
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

const probe = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/__team', headers });

describe('requireMerchantTeam', () => {
  it('sets merchantClientId to the merchant id for the owner', async () => {
    const m = await createTestMerchant(app);
    const res = await probe(await memberAuthHeader(app, m.userId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: m.merchantId });
  });

  it('sets merchantClientId to the employer merchant id for active staff', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const s = await createTestStaff(app, m.merchantId, b.id);
    const res = await probe(s.auth);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: m.merchantId });
  });

  it('rejects inactive staff, staff of an inactive branch, and an inactive merchant', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const inactive = await createTestStaff(app, m.merchantId, b.id, { isActive: false });
    expect((await probe(inactive.auth)).statusCode).toBe(403);

    const s = await createTestStaff(app, m.merchantId, b.id);
    await app.db
      .update(schema.merchantBranches)
      .set({ isActive: false })
      .where(eq(schema.merchantBranches.id, b.id));
    expect((await probe(s.auth)).statusCode).toBe(403);

    const off = await createTestMerchant(app, { isActive: false });
    expect((await probe(await memberAuthHeader(app, off.userId))).statusCode).toBe(403);
  });

  it('rejects a user who is neither owner nor staff', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `nobody-${Date.now()}@test.com`,
        displayName: 'Nobody',
        emailVerified: true,
      })
      .returning();
    const res = await probe(await memberAuthHeader(app, user!.id));
    expect(res.statusCode).toBe(403);
  });

  it('rejects a Device token with 401', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    expect((await probe(d.auth)).statusCode).toBe(401);
  });
});
