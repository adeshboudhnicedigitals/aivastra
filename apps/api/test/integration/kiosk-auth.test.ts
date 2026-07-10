import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { hashRefresh, newRefreshToken, signAccess } from '../../src/modules/auth/service';
import { createKioskDevice } from '../../src/modules/kiosk/provisioning';
import { buildServer } from '../../src/server';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function buildKioskTestApp(c: Containers) {
  const app = await buildServer({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_PORT: 0,
    DATABASE_URL: c.pgUrl,
    REDIS_URL: c.redisUrl,
    JWT_SECRET,
    JWT_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    R2_ENDPOINT: c.r2Endpoint,
    R2_ACCESS_KEY_ID: c.r2Key,
    R2_SECRET_ACCESS_KEY: c.r2Secret,
    R2_BUCKET: c.r2Bucket,
    R2_PUBLIC_URL: `${c.r2Endpoint}/${c.r2Bucket}`,
    R2_FORCE_PATH_STYLE: true,
    CORS_ORIGIN: ['http://localhost:3000'],
    COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef-32min',
    RESEND_API_KEY: 'test',
    EMAIL_FROM: 'test@example.com',
  } as Env);
  app.get('/test/kiosk-gated', { preHandler: app.requireKioskDevice }, async (req) => ({
    kioskDeviceId: req.kioskDeviceId,
    merchantClientId: req.merchantClientId,
  }));
  await app.listen({ port: 0 });
  return app;
}

async function seedMerchantClient(app: TestApp, email: string) {
  const [merchantUser] = await app.db
    .insert(schema.users)
    .values({ email, passwordHash: 'unused' })
    .returning();

  const [client] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Kiosk Co',
      contactName: 'Kiosk Owner',
      phone: '9999999999',
      websiteUrl: 'https://example.com',
      companySize: '1-10',
      purpose: 'kiosk tests',
      businessAddress: 'Test Street',
      isActive: true,
      userId: merchantUser.id,
    })
    .returning();
  return client;
}

describe('kiosk auth foundation', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildKioskTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('provisions, claims, refreshes, rejects cross-audience access, logs out, and re-pairs', async () => {
    const client = await seedMerchantClient(app, 'kiosk-main@example.com');

    const created = await createKioskDevice(app, client.id, 'Front Counter Tablet');
    expect(created.pairingCode).toMatch(/^[A-Z2-7]{10}$/);

    const [pending] = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, created.device.id));
    expect(pending.status).toBe('pending');
    expect(pending.pairingCodeHash).toEqual(expect.any(String));
    expect(pending.pairingCodeHash).not.toBe(created.pairingCode);

    const claim = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/claim',
      payload: { pairingCode: created.pairingCode, appVersion: '1.0.0', androidId: 'android-a' },
    });
    expect(claim.statusCode).toBe(200);
    const claimedTokens = claim.json() as { accessToken: string; refreshToken: string };
    expect(claimedTokens.accessToken).toEqual(expect.any(String));
    expect(claimedTokens.refreshToken).toEqual(expect.any(String));

    const [active] = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, created.device.id));
    expect(active.status).toBe('active');
    expect(active.pairingCodeHash).toBeNull();

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/claim',
      payload: { pairingCode: created.pairingCode },
    });
    expect(replay.statusCode).toBe(401);

    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/refresh',
      payload: { refreshToken: claimedTokens.refreshToken, appVersion: '1.0.1' },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshedTokens = refresh.json() as { accessToken: string; refreshToken: string };
    const verified = await jwtVerify(refreshedTokens.accessToken, secret, { audience: 'kiosk' });
    expect(verified.payload.sub).toBe(created.device.id);

    const adminAudienceToken = await signAccess(
      secret,
      created.device.id,
      { kind: 'access' },
      '15m',
      'admin',
    );
    const gated = await app.inject({
      method: 'GET',
      url: '/test/kiosk-gated',
      headers: { authorization: `Bearer ${adminAudienceToken}` },
    });
    expect(gated.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/logout',
      payload: { refreshToken: refreshedTokens.refreshToken },
    });
    expect(logout.statusCode).toBe(200);
    const [revoked] = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, created.device.id));
    expect(revoked.status).toBe('revoked');

    const afterLogoutRefresh = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/refresh',
      payload: { refreshToken: refreshedTokens.refreshToken },
    });
    expect(afterLogoutRefresh.statusCode).toBe(401);

    const merchantToken = await signAccess(secret, client.userId, { kind: 'access' }, '7d');
    const regenerate = await app.inject({
      method: 'POST',
      url: `/v1/merchant/kiosk-devices/${created.device.id}/pairing-code`,
      headers: { authorization: `Bearer ${merchantToken}` },
    });
    expect(regenerate.statusCode).toBe(200);
    const regenerated = regenerate.json() as { pairingCode: string };
    expect(regenerated.pairingCode).toMatch(/^[A-Z2-7]{10}$/);
    expect(regenerated.pairingCode).not.toBe(created.pairingCode);

    const reClaim = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/claim',
      payload: { pairingCode: regenerated.pairingCode },
    });
    expect(reClaim.statusCode).toBe(200);
    const [reActive] = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, created.device.id));
    expect(reActive.status).toBe('active');

    const oldFamilyRefresh = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/refresh',
      payload: { refreshToken: refreshedTokens.refreshToken },
    });
    expect(oldFamilyRefresh.statusCode).toBe(401);
  });

  it('rate-limits the 11th claim attempt from one IP within a minute', async () => {
    const attempts = [];
    const remoteAddress = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    for (let i = 0; i < 11; i += 1) {
      attempts.push(
        await app.inject({
          method: 'POST',
          url: '/v1/kiosk/auth/claim',
          remoteAddress,
          payload: { pairingCode: `BADCODE${i}` },
        }),
      );
    }
    expect(attempts.slice(0, 10).every((res) => res.statusCode === 401)).toBe(true);
    expect(attempts[10].statusCode).toBe(429);
  });

  it('rejects user-owned refresh tokens and enforces exactly one refresh-token owner', async () => {
    const client = await seedMerchantClient(app, 'kiosk-owner-check@example.com');
    const { device } = await createKioskDevice(app, client.id, 'Owner Check Tablet');
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: 'kiosk-user-token@example.com', emailVerified: true, tier: 'free' })
      .returning();

    const userRefresh = newRefreshToken();
    await app.db.insert(schema.refreshTokens).values({
      userId: user.id,
      familyId: randomUUID(),
      generation: 1,
      tokenHash: userRefresh.hash,
      expiresAt: new Date(Date.now() + 60_000),
      portal: 'web',
    });

    const crossPortal = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/auth/refresh',
      payload: { refreshToken: userRefresh.plain },
    });
    expect(crossPortal.statusCode).toBe(401);

    await expect(
      app.db.insert(schema.refreshTokens).values({
        familyId: randomUUID(),
        generation: 1,
        tokenHash: hashRefresh('zero-owner'),
        expiresAt: new Date(Date.now() + 60_000),
        portal: 'kiosk',
      }),
    ).rejects.toThrow();

    await expect(
      app.db.insert(schema.refreshTokens).values({
        userId: user.id,
        kioskDeviceId: device.id,
        familyId: randomUUID(),
        generation: 1,
        tokenHash: hashRefresh('two-owners'),
        expiresAt: new Date(Date.now() + 60_000),
        portal: 'kiosk',
      }),
    ).rejects.toThrow();

    const ownerRows = await app.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, user.id),
          eq(schema.refreshTokens.tokenHash, userRefresh.hash),
        ),
      );
    expect(ownerRows).toHaveLength(1);
  });
});
