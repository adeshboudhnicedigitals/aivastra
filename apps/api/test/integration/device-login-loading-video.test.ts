import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant } from '../helpers/merchant.js';

const CONFIG_KEY = 'config:system';

describe('device-login loadingVideoUrl', () => {
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
  afterEach(async () => {
    await app.redis.del(CONFIG_KEY);
  });

  async function setPassword(userId: string, password: string) {
    const passwordHash = await hashPassword(password);
    await app.db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  }

  it('returns the merchant loading-video URL when one is configured, overriding the global clip', async () => {
    const { merchantId, userId } = await createTestMerchant(app);
    await setPassword(userId, 'password123');
    await app.db
      .update(schema.merchants)
      .set({ loadingVideoKey: `merchant-loading-video/${merchantId}/video.mp4` })
      .where(eq(schema.merchants.id, merchantId));
    // A global clip is also configured, to prove the merchant override wins over it.
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({
        appVideo: { key: 'config/app-video.mp4', updatedAt: new Date().toISOString() },
      }),
    );
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device-login',
      payload: {
        email: user?.email,
        password: 'password123',
        deviceId: 'device-1',
        deviceName: 'Test Device',
        platform: 'mobile',
      },
    });
    expect(res.statusCode).toBe(200);
    const loadingVideoUrl = res.json().loadingVideoUrl as string;
    expect(loadingVideoUrl).toContain(`merchant-loading-video/${merchantId}/video.mp4`);
  });

  it('falls back to the global app-video clip when the merchant has no override', async () => {
    const { userId } = await createTestMerchant(app);
    await setPassword(userId, 'password123');
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({
        appVideo: { key: 'config/app-video.mp4', updatedAt: new Date().toISOString() },
      }),
    );
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device-login',
      payload: {
        email: user?.email,
        password: 'password123',
        deviceId: 'device-2',
        deviceName: 'Test Device',
        platform: 'mobile',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loadingVideoUrl).toContain('config/app-video.mp4');
  });

  it('returns null when neither a merchant override nor a global clip is configured', async () => {
    const { userId } = await createTestMerchant(app);
    await setPassword(userId, 'password123');
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/device-login',
      payload: {
        email: user?.email,
        password: 'password123',
        deviceId: 'device-3',
        deviceName: 'Test Device',
        platform: 'mobile',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loadingVideoUrl).toBeNull();
  });
});
