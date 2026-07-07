import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { createKioskDevice } from '../../src/modules/kiosk/provisioning';
import { buildServer } from '../../src/server';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';

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
  await app.listen({ port: 0 });
  return app;
}

async function seedMerchant(app: TestApp, email: string, balance = 100) {
  const [client] = await app.db
    .insert(schema.widgetClients)
    .values({
      companyName: 'Kiosk Co',
      contactName: 'Kiosk Owner',
      email,
      phone: '9999999999',
      websiteUrl: 'https://example.com',
      companySize: '1-10',
      purpose: 'kiosk tests',
      businessAddress: 'Test Street',
      passwordHash: 'unused',
      isActive: true,
      kioskEnabled: true,
      maxKioskDevices: 5,
    })
    .returning();

  await app.db.insert(schema.widgetClientCredits).values({
    widgetClientId: client.id,
    balance,
  });

  return client;
}

async function claimDevice(app: TestApp, widgetClientId: string, label: string, androidId: string) {
  const { device, pairingCode } = await createKioskDevice(app, widgetClientId, label);
  const claim = await app.inject({
    method: 'POST',
    url: '/v1/kiosk/auth/claim',
    payload: { pairingCode, androidId, appVersion: '1.0.0' },
  });
  expect(claim.statusCode).toBe(200);
  const body = claim.json() as { accessToken: string; refreshToken: string };
  return { device, accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function uploadCustomerPhoto(app: TestApp, accessToken: string, bytes: Buffer) {
  const presign = await app.inject({
    method: 'POST',
    url: '/v1/kiosk/presign',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { contentType: 'image/jpeg', contentLength: bytes.length },
  });
  expect(presign.statusCode).toBe(200);
  const { uploadUrl, r2Key } = presign.json() as { uploadUrl: string; r2Key: string };
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  });
  expect(put.ok).toBe(true);
  return r2Key;
}

async function seedCatalogItem(app: TestApp, widgetClientId: string) {
  const id = randomUUID();
  const imageKey = `merchant-catalog/${widgetClientId}/${id}/image.jpg`;
  const thumbKey = `merchant-catalog/${widgetClientId}/${id}/thumb.jpg`;
  await app.storage.putObject(imageKey, Buffer.from('catalog-image'), 'image/jpeg');
  await app.storage.putObject(thumbKey, Buffer.from('catalog-thumb'), 'image/jpeg');

  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      id,
      widgetClientId,
      label: 'Blue Saree',
      sku: 'SKU-001',
      gender: 'women',
      category: 'Sarees',
      r2Key: imageKey,
      thumbnailKey: thumbKey,
      isActive: true,
      moderationStatus: 'approved',
    })
    .returning();

  return item;
}

function streamEntryToObject(entry: [string, string[]] | undefined) {
  if (!entry) return null;
  const [, fields] = entry;
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key && value) out[key] = value;
  }
  return out;
}

describe('kiosk jobs', () => {
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

  it('creates kiosk jobs atomically, routes through the widget pipeline, exposes share URLs, and enforces merchant isolation for like/cart', async () => {
    const merchant = await seedMerchant(app, 'merchant-a@example.com', 100);
    const otherMerchant = await seedMerchant(app, 'merchant-b@example.com', 100);
    const ownerDevice = await claimDevice(app, merchant.id, 'Front Tablet', 'android-owner');
    const outsiderDevice = await claimDevice(
      app,
      otherMerchant.id,
      'Other Tablet',
      'android-outsider',
    );
    const item = await seedCatalogItem(app, merchant.id);

    const customerPhotoKey = await uploadCustomerPhoto(
      app,
      ownerDevice.accessToken,
      Buffer.from('customer-photo-a'),
    );

    const create = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/jobs',
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
      payload: { merchantCatalogItemId: item.id, customerPhotoKey },
    });
    expect(create.statusCode).toBe(201);
    const { jobId } = create.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.widgetClientId).toBe(merchant.id);
    expect(job.kioskDeviceId).toBe(ownerDevice.device.id);
    expect(job.status).toBe('QUEUED');

    const streamEntries = await app.redis.xrevrange('jobs:normal', '+', '-', 'COUNT', 1);
    const streamPayload = streamEntryToObject(streamEntries[0]);
    expect(streamPayload).toMatchObject({ jobId, type: 'WIDGET_TRYON' });

    const [credits] = await app.db
      .select()
      .from(schema.widgetClientCredits)
      .where(eq(schema.widgetClientCredits.widgetClientId, merchant.id));
    expect(credits.balance).toBe(90);

    const ledgerRows = await app.db
      .select()
      .from(schema.widgetCreditLedger)
      .where(eq(schema.widgetCreditLedger.jobId, jobId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.delta).toBe(-10);
    expect(ledgerRows[0]?.reason).toBe('JOB_DISPATCH');

    const resultBytes = Buffer.from('completed-kiosk-result');
    const resultKey = `widget-outputs/${jobId}/result.png`;
    await app.storage.putObject(resultKey, resultBytes, 'image/png');
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED', completedAt: new Date() })
      .where(eq(schema.jobs.id, jobId));
    await app.db.insert(schema.jobOutputs).values({ jobId, resultKey });

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/kiosk/jobs/${jobId}`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      shareUrl: string | null;
      liked: boolean;
      inCart: boolean;
    };
    expect(detailBody.shareUrl).toEqual(expect.any(String));
    expect(detailBody.liked).toBe(false);
    expect(detailBody.inCart).toBe(false);

    const shareFetch = await fetch(detailBody.shareUrl as string);
    expect(shareFetch.ok).toBe(true);
    expect(Buffer.from(await shareFetch.arrayBuffer())).toEqual(resultBytes);

    const forgedLike = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/like`,
      headers: {
        authorization: `Bearer ${ownerDevice.accessToken}`,
        'content-type': 'application/json',
      },
      payload: { widgetClientId: otherMerchant.id, userId: 'forged-user' },
    });
    expect(forgedLike.statusCode).toBe(400);

    const forgedCart = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/cart`,
      headers: {
        authorization: `Bearer ${ownerDevice.accessToken}`,
        'content-type': 'application/json',
      },
      payload: { widgetClientId: otherMerchant.id, userId: 'forged-user' },
    });
    expect(forgedCart.statusCode).toBe(400);

    const like = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/like`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(like.statusCode).toBe(204);

    const cart = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/cart`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(cart.statusCode).toBe(204);

    const updatedDetail = await app.inject({
      method: 'GET',
      url: `/v1/kiosk/jobs/${jobId}`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(updatedDetail.statusCode).toBe(200);
    const updatedBody = updatedDetail.json() as { liked: boolean; inCart: boolean };
    expect(updatedBody.liked).toBe(true);
    expect(updatedBody.inCart).toBe(true);

    const outsiderLike = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/like`,
      headers: { authorization: `Bearer ${outsiderDevice.accessToken}` },
    });
    expect(outsiderLike.statusCode).toBe(404);

    const outsiderCart = await app.inject({
      method: 'PUT',
      url: `/v1/kiosk/results/${jobId}/cart`,
      headers: { authorization: `Bearer ${outsiderDevice.accessToken}` },
    });
    expect(outsiderCart.statusCode).toBe(404);

    const likeRows = await app.db
      .select()
      .from(schema.kioskResultLikes)
      .where(
        and(
          eq(schema.kioskResultLikes.jobId, jobId),
          eq(schema.kioskResultLikes.widgetClientId, merchant.id),
        ),
      );
    expect(likeRows).toHaveLength(1);
    expect(likeRows[0]?.kioskDeviceId).toBe(ownerDevice.device.id);

    const cartRows = await app.db
      .select()
      .from(schema.kioskResultCartItems)
      .where(
        and(
          eq(schema.kioskResultCartItems.jobId, jobId),
          eq(schema.kioskResultCartItems.widgetClientId, merchant.id),
        ),
      );
    expect(cartRows).toHaveLength(1);
    expect(cartRows[0]?.kioskDeviceId).toBe(ownerDevice.device.id);

    const unlike = await app.inject({
      method: 'DELETE',
      url: `/v1/kiosk/results/${jobId}/like`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(unlike.statusCode).toBe(204);

    const uncart = await app.inject({
      method: 'DELETE',
      url: `/v1/kiosk/results/${jobId}/cart`,
      headers: { authorization: `Bearer ${ownerDevice.accessToken}` },
    });
    expect(uncart.statusCode).toBe(204);
  });

  it('rejects a customer photo key presigned by device A when device B submits the job', async () => {
    const merchant = await seedMerchant(app, 'merchant-shared@example.com', 100);
    const deviceA = await claimDevice(app, merchant.id, 'Tablet A', 'android-a');
    const deviceB = await claimDevice(app, merchant.id, 'Tablet B', 'android-b');
    const item = await seedCatalogItem(app, merchant.id);

    const keyA = await uploadCustomerPhoto(
      app,
      deviceA.accessToken,
      Buffer.from('customer-photo-b'),
    );

    const create = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/jobs',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: keyA },
    });
    expect(create.statusCode).toBe(403);
  });

  it('fails atomically when merchant credits are insufficient', async () => {
    const merchant = await seedMerchant(app, 'merchant-low-balance@example.com', 5);
    const device = await claimDevice(app, merchant.id, 'Balance Tablet', 'android-balance');
    const item = await seedCatalogItem(app, merchant.id);
    const customerPhotoKey = await uploadCustomerPhoto(
      app,
      device.accessToken,
      Buffer.from('customer-photo-low-balance'),
    );

    const create = await app.inject({
      method: 'POST',
      url: '/v1/kiosk/jobs',
      headers: { authorization: `Bearer ${device.accessToken}` },
      payload: { merchantCatalogItemId: item.id, customerPhotoKey },
    });
    expect(create.statusCode).toBe(402);
    expect(create.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'insufficient credits' },
    });

    const jobs = await app.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.widgetClientId, merchant.id),
          eq(schema.jobs.customerPhotoKey, customerPhotoKey),
        ),
      );
    expect(jobs).toHaveLength(0);

    const [credits] = await app.db
      .select()
      .from(schema.widgetClientCredits)
      .where(eq(schema.widgetClientCredits.widgetClientId, merchant.id));
    expect(credits.balance).toBe(5);

    const ledger = await app.db
      .select()
      .from(schema.widgetCreditLedger)
      .where(eq(schema.widgetCreditLedger.widgetClientId, merchant.id));
    expect(ledger).toHaveLength(0);
  });
});
