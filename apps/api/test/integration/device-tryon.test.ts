import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chargeInStoreTryon, isDeviceCovered } from '../../src/modules/device/entitlement';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestCatalogItem,
  createTestCatalogItemWithSecondImage,
  createTestDevice,
  createTestGarmentType,
  createTestMerchant,
  createTestStaff,
  createTestTwoInputGarmentType,
  memberAuthHeader,
  stageCustomerPhoto,
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

async function setup(balance = 100) {
  const m = await createTestMerchant(app, { balance });
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const garmentType = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
  const session = (
    await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: device.auth,
      payload: { mode: 'kiosk' },
    })
  ).json() as { id: string };
  return { m, branch, device, item, session };
}
const balanceOf = async (userId: string) =>
  (await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId)))[0]!
    .balance;

describe('entitlement', () => {
  it('isDeviceCovered is false until the subscription module ships', async () => {
    expect(await isDeviceCovered(randomUUID())).toBe(false);
  });

  it('treats a throwing coverage check as not covered and charges credits', async () => {
    const { m, device } = await setup(20);
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({
      id: jobId,
      userId: m.userId,
      merchantId: m.merchantId,
      status: 'QUEUED',
      creditsCharged: 5,
      source: 'merchant_tryon',
    });
    await app.db.transaction(async (tx) => {
      await chargeInStoreTryon(
        tx,
        { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId },
        async () => {
          throw new Error('subscription module down');
        },
      );
    });
    expect(await balanceOf(m.userId)).toBe(15);
  });

  it('charges when the coverage check returns a truthy non-boolean (gate compares === true)', async () => {
    for (const bogus of ['false', 1]) {
      const { m, device } = await setup(20);
      const jobId = randomUUID();
      await app.db.insert(schema.jobs).values({
        id: jobId,
        userId: m.userId,
        merchantId: m.merchantId,
        status: 'QUEUED',
        creditsCharged: 5,
        source: 'merchant_tryon',
      });
      await app.db.transaction(async (tx) => {
        await chargeInStoreTryon(
          tx,
          { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId },
          (async () => bogus) as never,
        );
      });
      expect(await balanceOf(m.userId), String(bogus)).toBe(15);
    }
  });

  it('charges when the coverage check throws synchronously', async () => {
    const { m, device } = await setup(20);
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({
      id: jobId,
      userId: m.userId,
      merchantId: m.merchantId,
      status: 'QUEUED',
      creditsCharged: 5,
      source: 'merchant_tryon',
    });
    await app.db.transaction(async (tx) => {
      await chargeInStoreTryon(
        tx,
        { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId },
        (() => {
          throw new Error('sync boom');
        }) as never,
      );
    });
    expect(await balanceOf(m.userId)).toBe(15);
  });

  it('skips the charge when the device is covered', async () => {
    const { m, device } = await setup(20);
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({
      id: jobId,
      userId: m.userId,
      merchantId: m.merchantId,
      status: 'QUEUED',
      creditsCharged: 0,
      source: 'merchant_tryon',
    });
    await app.db.transaction(async (tx) => {
      await chargeInStoreTryon(
        tx,
        { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId },
        async () => true,
      );
    });
    expect(await balanceOf(m.userId)).toBe(20);
  });
});

describe('POST /v1/device/tryon/jobs', () => {
  it('creates an attributed job, charges credits, writes a tried item, and the device can read it', async () => {
    const { m, branch, device, item, session } = await setup(100);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: device.auth,
      payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({
      merchantId: m.merchantId,
      branchId: branch.id,
      deviceId: device.deviceId,
      sessionId: session.id,
      creditsCharged: 5,
    });
    expect(await balanceOf(m.userId)).toBe(95);

    const [tried] = await app.db
      .select()
      .from(schema.sessionItems)
      .where(
        and(eq(schema.sessionItems.sessionId, session.id), eq(schema.sessionItems.action, 'tried')),
      );
    expect(tried).toMatchObject({ jobId, catalogItemId: item.id });

    const read = await app.inject({
      method: 'GET',
      url: `/v1/device/tryon/jobs/${jobId}`,
      headers: device.auth,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: jobId, status: 'QUEUED' });
  });

  it("attributes the job to the session's branch even if the device was moved since", async () => {
    const { m, branch, device, item, session } = await setup(100);
    const elsewhere = await createTestBranch(app, m.merchantId);
    // Simulates a move racing an in-flight request (the PATCH route itself ends sessions).
    await app.db
      .update(schema.merchantDevices)
      .set({ branchId: elsewhere.id })
      .where(eq(schema.merchantDevices.id, device.deviceId));
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: device.auth,
      payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const [job] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, (res.json() as { jobId: string }).jobId));
    expect(job!.branchId).toBe(branch.id);
  });

  it('attributes the session staff member', async () => {
    const { m, branch, device, item } = await setup(100);
    const staff = await createTestStaff(app, m.merchantId, branch.id);
    const s = (
      await app.inject({
        method: 'POST',
        url: '/v1/device/sessions',
        headers: { ...device.auth, 'x-staff-authorization': staff.auth.authorization },
        payload: { mode: 'assisted' },
      })
    ).json() as { id: string };
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const { jobId } = (
      await app.inject({
        method: 'POST',
        url: '/v1/device/tryon/jobs',
        headers: device.auth,
        payload: { sessionId: s.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
      })
    ).json() as { jobId: string };
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job!.staffId).toBe(staff.staffId);
  });

  it('returns 402 and leaves no job row when credits are insufficient', async () => {
    const { m, device, item, session } = await setup(2);
    const before = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, m.merchantId));
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: device.auth,
      payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('INSUFFICIENT_CREDITS');
    const after = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, m.merchantId));
    expect(after.length).toBe(before.length);
    expect(await balanceOf(m.userId)).toBe(2);
    const triedRows = await app.db
      .select()
      .from(schema.sessionItems)
      .where(eq(schema.sessionItems.sessionId, session.id));
    expect(triedRows).toHaveLength(0);
  });

  it('is idempotent: a retry with the same key charges once', async () => {
    const { m, device, item, session } = await setup(100);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/device/tryon/jobs',
        headers: { ...device.auth, 'idempotency-key': 'k-1' },
        payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
      });
    const a = (await send()).json() as { jobId: string };
    const b = (await send()).json() as { jobId: string };
    expect(a.jobId).toBe(b.jobId);
    expect(await balanceOf(m.userId)).toBe(95);
  });

  it("refuses an ended session, another device's session, a foreign photo and a foreign catalog item", async () => {
    const a = await setup(100);
    const other = await setup(100);
    const photo = await stageCustomerPhoto(app, a.m.merchantId);
    const post = (headers: Record<string, string>, payload: object) =>
      app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers, payload });

    expect(
      (
        await post(other.device.auth, {
          sessionId: a.session.id,
          merchantCatalogItemId: other.item.id,
          customerPhotoKey: await stageCustomerPhoto(app, other.m.merchantId),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(a.device.auth, {
          sessionId: a.session.id,
          merchantCatalogItemId: a.item.id,
          customerPhotoKey: await stageCustomerPhoto(app, other.m.merchantId),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(a.device.auth, {
          sessionId: a.session.id,
          merchantCatalogItemId: other.item.id,
          customerPhotoKey: photo,
        })
      ).statusCode,
    ).toBe(404);

    await app.inject({
      method: 'POST',
      url: `/v1/device/sessions/${a.session.id}/end`,
      headers: a.device.auth,
    });
    const ended = await post(a.device.auth, {
      sessionId: a.session.id,
      merchantCatalogItemId: a.item.id,
      customerPhotoKey: photo,
    });
    expect(ended.statusCode).toBe(409);
    expect(ended.json().error.code).toBe('SESSION_ENDED');
  });

  it("a device cannot read another device's job", async () => {
    const a = await setup(100);
    const other = await setup(100);
    const photo = await stageCustomerPhoto(app, a.m.merchantId);
    const { jobId } = (
      await app.inject({
        method: 'POST',
        url: '/v1/device/tryon/jobs',
        headers: a.device.auth,
        payload: {
          sessionId: a.session.id,
          merchantCatalogItemId: a.item.id,
          customerPhotoKey: photo,
        },
      })
    ).json() as { jobId: string };
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/tryon/jobs/${jobId}`,
      headers: other.device.auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it('presigns a customer photo under this merchant', async () => {
    const { m, device } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/presign',
      headers: device.auth,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { r2Key: string }).r2Key.startsWith(`merchant-inputs/${m.merchantId}/`),
    ).toBe(true);
  });
});

describe('two-step (two-input) garment', () => {
  it('charges 5 on the try-on job only; the mannequin job is uncharged and unattributed', async () => {
    const m = await createTestMerchant(app, { balance: 100 });
    const branch = await createTestBranch(app, m.merchantId);
    const device = await createTestDevice(app, m.merchantId, branch.id);
    const { garmentType } = await createTestTwoInputGarmentType(app);
    const item = await createTestCatalogItemWithSecondImage(app, m.merchantId, garmentType.id);
    const session = (
      await app.inject({
        method: 'POST',
        url: '/v1/device/sessions',
        headers: device.auth,
        payload: { mode: 'kiosk' },
      })
    ).json() as { id: string };
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/tryon/jobs',
      headers: device.auth,
      payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({
      status: 'PENDING_MANNEQUIN',
      creditsCharged: 5,
      deviceId: device.deviceId,
      sessionId: session.id,
      branchId: branch.id,
    });
    const [tried] = await app.db
      .select()
      .from(schema.sessionItems)
      .where(
        and(eq(schema.sessionItems.sessionId, session.id), eq(schema.sessionItems.jobId, jobId)),
      );
    expect(tried).toMatchObject({ action: 'tried', catalogItemId: item.id });

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const mannequinJobId = (inputs!.params as { mannequinJobId: string }).mannequinJobId;
    const [mannequin] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, mannequinJobId));
    expect(mannequin).toMatchObject({ creditsCharged: 0, deviceId: null, sessionId: null });
    expect(await balanceOf(m.userId)).toBe(95);
  });
});

describe('legacy path is unchanged', () => {
  it('an owner-token try-on still charges credits and leaves attribution null', async () => {
    const m = await createTestMerchant(app, { balance: 100 });
    const garmentType = await createTestGarmentType(app);
    const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: await memberAuthHeader(app, m.userId),
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const [job] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, (res.json() as { jobId: string }).jobId));
    expect(job).toMatchObject({
      creditsCharged: 5,
      branchId: null,
      deviceId: null,
      sessionId: null,
      staffId: null,
    });
    expect(await balanceOf(m.userId)).toBe(95);
    const items = await app.db.select().from(schema.sessionItems);
    expect(items.some((i) => i.jobId === job!.id)).toBe(false);
  });
});
