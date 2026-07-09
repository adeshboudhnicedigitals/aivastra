import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

async function createMerchant(
  app: TestApp,
  email: string,
  overrides: Partial<typeof schema.merchants.$inferInsert> = {},
) {
  const [merchantUser] = await app.db
    .insert(schema.users)
    .values({ email, passwordHash: 'unused' })
    .returning();

  const [merchant] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Merchant Co',
      contactName: 'Merchant Owner',
      phone: '9999999999',
      websiteUrl: 'https://example.com',
      companySize: '1-10',
      purpose: 'merchant tests',
      businessAddress: 'Test Street',
      isActive: true,
      kioskEnabled: false,
      userId: merchantUser.id,
      ...overrides,
    })
    .returning();

  await app.db.insert(schema.merchantCredits).values({
    merchantId: merchant.id,
    balance: 0,
  });

  return merchant;
}

async function createSuperAdmin(app: TestApp, email: string) {
  const [user] = await app.db
    .insert(schema.users)
    .values({ email, emailVerified: true, tier: 'free' })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
  await app.db.insert(schema.adminUsers).values({
    userId: user.id,
    role: 'SUPER_ADMIN',
    status: 'active',
  });
  return user;
}

describe('merchant kiosk device admin controls', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('allows admin device creation and rejects merchant creation when kiosk is disabled', async () => {
    const merchant = await createMerchant(app, 'kiosk-phase2@example.com', {
      kioskEnabled: false,
      maxKioskDevices: 1,
    });
    const merchantToken = await signAccess(secret, merchant.userId, { kind: 'access' }, '15m');

    const merchantCreate = await app.inject({
      method: 'POST',
      url: '/v1/merchant/kiosk-devices',
      headers: { authorization: `Bearer ${merchantToken}` },
      payload: { label: 'Merchant Tablet' },
    });
    expect(merchantCreate.statusCode).toBe(403);

    const adminUser = await createSuperAdmin(app, 'phase2-admin@example.com');
    const adminToken = await signAccess(secret, adminUser.id, { kind: 'access' }, '15m', 'admin');

    const adminCreate = await app.inject({
      method: 'POST',
      url: `/v1/admin/merchants/${merchant.id}/kiosk-devices`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: 'Admin Tablet' },
    });
    expect(adminCreate.statusCode).toBe(201);
    const created = adminCreate.json() as {
      pairingCode: string;
      device: { id: string; status: string; merchantId: string };
    };
    expect(created.pairingCode).toMatch(/^[A-Z2-7]{10}$/);
    expect(created.device.status).toBe('pending');
    expect(created.device.merchantId).toBe(merchant.id);

    const claim = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/claim',
      payload: { pairingCode: created.pairingCode, androidId: 'admin-device', appVersion: '1.0.0' },
    });
    expect(claim.statusCode).toBe(200);

    const [device] = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, created.device.id));
    expect(device?.status).toBe('active');
  });
});
