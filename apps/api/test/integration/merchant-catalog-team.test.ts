import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  merchantCanReferenceCatalogItem,
  resolveTryonGarment,
} from '../../src/modules/merchant/resolve-tryon-garment';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
  createTestGarmentType,
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

// ---------------------------------------------------------------------------
// Catalogue routes on requireMerchantTeam: staff access, tenancy, soft delete,
// audit and job attribution. Owner behaviour is pinned alongside each staff case.
// ---------------------------------------------------------------------------

type Auth = Record<string, string>;

async function team() {
  const m = await createTestMerchant(app);
  const owner = await memberAuthHeader(app, m.userId);
  const b = await createTestBranch(app, m.merchantId);
  const s = await createTestStaff(app, m.merchantId, b.id);
  const garmentType = await createTestGarmentType(app);
  return { m, owner, b, s, garmentType };
}

async function createSubcategory(auth: Auth, garmentSubcategoryId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/merchant/catalog/subcategories',
    headers: auth,
    payload: { category: 'women', name: `Sub ${randomUUID().slice(0, 6)}`, garmentSubcategoryId },
  });
  return res;
}

async function presignPut(auth: Auth, kind: 'image' | 'thumbnail' | 'flat') {
  const presign = await app.inject({
    method: 'POST',
    url: '/v1/merchant/catalog/presign',
    headers: auth,
    payload: { kind, contentType: 'image/jpeg', contentLength: 4 },
  });
  expect(presign.statusCode).toBe(200);
  const { r2Key, uploadUrl } = presign.json() as { r2Key: string; uploadUrl: string };
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from('jpeg'),
  });
  expect(put.ok).toBe(true);
  return r2Key;
}

async function createItem(auth: Auth, subcategoryId: string) {
  const r2Key = await presignPut(auth, 'image');
  const thumbnailKey = await presignPut(auth, 'thumbnail');
  const res = await app.inject({
    method: 'POST',
    url: '/v1/merchant/catalog',
    headers: auth,
    payload: {
      subcategoryId,
      label: 'Blue Kurta',
      actualPrice: 1000,
      offerPrice: 900,
      r2Key,
      thumbnailKey,
    },
  });
  return { res, r2Key, thumbnailKey };
}

async function itemRow(id: string) {
  const [row] = await app.db
    .select()
    .from(schema.merchantCatalogItems)
    .where(eq(schema.merchantCatalogItems.id, id));
  return row;
}

async function auditsFor(resourceId: string) {
  return app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, resourceId));
}

async function exists(key: string) {
  return app.storage
    .headObject(key)
    .then(() => true)
    .catch(() => false);
}

describe('catalogue routes: staff access and tenancy', () => {
  it('staff lists subcategories and items of their own merchant only', async () => {
    const a = await team();
    const other = await team();
    const subA = await createSubcategory(a.owner, a.garmentType.id);
    expect(subA.statusCode).toBe(201);
    const subB = await createSubcategory(other.owner, other.garmentType.id);
    const { res: itemB } = await createItem(other.owner, subB.json().id);
    expect(itemB.statusCode).toBe(201);

    const subs = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog/subcategories?includeDemo=false',
      headers: a.s.auth,
    });
    expect(subs.statusCode).toBe(200);
    expect(subs.json().items.map((r: { id: string }) => r.id)).toEqual([subA.json().id]);

    // Filtering by merchant B's subcategory id yields nothing, never B's rows.
    const items = await app.inject({
      method: 'GET',
      url: `/v1/merchant/catalog?includeDemo=false&subcategoryId=${subB.json().id}`,
      headers: a.s.auth,
    });
    expect(items.statusCode).toBe(200);
    expect(items.json().items).toEqual([]);
  });

  it("returns 404 to staff of merchant A for merchant B's item, subcategory and generate job", async () => {
    const a = await team();
    const other = await team();
    const subB = await createSubcategory(other.owner, other.garmentType.id);
    const { res: itemB } = await createItem(other.owner, subB.json().id);
    const itemId = itemB.json().id as string;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/${itemId}`,
      headers: a.s.auth,
      payload: { label: 'hijack' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/${itemId}`,
      headers: a.s.auth,
    });
    expect(del.statusCode).toBe(404);
    expect((await itemRow(itemId))?.deletedAt).toBeNull();

    const subPatch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/subcategories/${subB.json().id}`,
      headers: a.s.auth,
      payload: { name: 'hijack' },
    });
    expect(subPatch.statusCode).toBe(404);

    const [jobB] = await app.db
      .insert(schema.jobs)
      .values({ userId: other.m.userId, status: 'COMPLETED', creditsCharged: 1 })
      .returning();
    const job = await app.inject({
      method: 'GET',
      url: `/v1/merchant/catalog/generate/${jobB!.id}`,
      headers: a.s.auth,
    });
    expect(job.statusCode).toBe(404);
  });

  it('rejects inactive staff and staff of an inactive branch with 403 on catalogue routes', async () => {
    const a = await team();
    const inactive = await createTestStaff(app, a.m.merchantId, a.b.id, { isActive: false });
    const list = (auth: Auth) =>
      app.inject({ method: 'GET', url: '/v1/merchant/catalog', headers: auth });
    expect((await list(inactive.auth)).statusCode).toBe(403);
    expect((await list(a.s.auth)).statusCode).toBe(200);
    await app.db
      .update(schema.merchantBranches)
      .set({ isActive: false })
      .where(eq(schema.merchantBranches.id, a.b.id));
    expect((await list(a.s.auth)).statusCode).toBe(403);
  });

  it('keeps subcategory DELETE owner-only: staff get 403 and nothing is removed', async () => {
    const a = await team();
    const sub = await createSubcategory(a.owner, a.garmentType.id);
    const { res: item } = await createItem(a.owner, sub.json().id);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/subcategories/${sub.json().id}`,
      headers: a.s.auth,
    });
    expect(res.statusCode).toBe(403);
    expect(await itemRow(item.json().id)).toBeDefined();
  });
});

describe('catalogue routes: staff mutations, soft delete and audit', () => {
  it('staff create subcategory + item, patch it and soft-delete it, each audited as MERCHANT_STAFF', async () => {
    const a = await team();
    const sub = await createSubcategory(a.s.auth, a.garmentType.id);
    expect(sub.statusCode).toBe(201);
    const subId = sub.json().id as string;
    const subPatch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/subcategories/${subId}`,
      headers: a.s.auth,
      payload: { name: 'Renamed' },
    });
    expect(subPatch.statusCode).toBe(200);
    const subAudits = await auditsFor(subId);
    expect(subAudits.map((r) => r.action).sort()).toEqual([
      'merchant_catalog_subcategory.create',
      'merchant_catalog_subcategory.update',
    ]);
    for (const r of subAudits) {
      expect(r.actorRole).toBe('MERCHANT_STAFF');
      expect(r.actorUserId).toBe(a.s.userId);
    }

    const { res, r2Key, thumbnailKey } = await createItem(a.s.auth, subId);
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/${id}`,
      headers: a.s.auth,
      payload: { label: 'Green Kurta' },
    });
    expect(patch.statusCode).toBe(200);
    expect((await itemRow(id))?.updatedByStaffId).toBe(a.s.staffId);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/${id}`,
      headers: a.s.auth,
    });
    expect(del.statusCode).toBe(204);
    const row = await itemRow(id);
    expect(row).toBeDefined();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.deletedByStaffId).toBe(a.s.staffId);
    expect(await exists(r2Key)).toBe(true);
    expect(await exists(thumbnailKey)).toBe(true);

    const audits = await auditsFor(id);
    expect(audits.map((r) => r.action).sort()).toEqual([
      'merchant_catalog.create',
      'merchant_catalog.soft_delete',
      'merchant_catalog.update',
    ]);
    for (const r of audits) {
      expect(r.actorRole).toBe('MERCHANT_STAFF');
      expect(r.actorUserId).toBe(a.s.userId);
    }
  });

  it('hides a soft-deleted item from lists, try-on resolution and reference checks', async () => {
    const a = await team();
    const sub = await createSubcategory(a.owner, a.garmentType.id);
    const subId = sub.json().id as string;
    const { res } = await createItem(a.owner, subId);
    const id = res.json().id as string;
    expect(await merchantCanReferenceCatalogItem(app, a.m.merchantId, id)).toBe(true);
    await expect(resolveTryonGarment(app, a.m.merchantId, id)).resolves.toMatchObject({
      kind: 'single',
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/merchant/catalog/${id}`, headers: a.s.auth }))
        .statusCode,
    ).toBe(204);

    for (const auth of [a.owner, a.s.auth]) {
      const list = await app.inject({
        method: 'GET',
        url: `/v1/merchant/catalog?includeDemo=false&subcategoryId=${subId}`,
        headers: auth,
      });
      expect(list.json().items).toEqual([]);
      const subs = await app.inject({
        method: 'GET',
        url: '/v1/merchant/catalog/subcategories?includeDemo=false',
        headers: auth,
      });
      expect(subs.json().items[0].productCount).toBe(0);
    }
    await expect(resolveTryonGarment(app, a.m.merchantId, id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await merchantCanReferenceCatalogItem(app, a.m.merchantId, id)).toBe(false);

    // A second staff delete and a staff PATCH of the hidden row both 404.
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/merchant/catalog/${id}`, headers: a.s.auth }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/merchant/catalog/${id}`,
          headers: a.s.auth,
          payload: { label: 'back' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('owner DELETE still hard-deletes and removes storage objects, also for a soft-deleted row', async () => {
    const a = await team();
    const sub = await createSubcategory(a.owner, a.garmentType.id);
    const subId = sub.json().id as string;

    const first = await createItem(a.owner, subId);
    const id1 = first.res.json().id as string;
    const del1 = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/${id1}`,
      headers: a.owner,
    });
    expect(del1.statusCode).toBe(204);
    expect(await itemRow(id1)).toBeUndefined();
    expect(await exists(first.r2Key)).toBe(false);
    expect(await exists(first.thumbnailKey)).toBe(false);

    const second = await createItem(a.owner, subId);
    const id2 = second.res.json().id as string;
    await app.inject({ method: 'DELETE', url: `/v1/merchant/catalog/${id2}`, headers: a.s.auth });
    expect((await itemRow(id2))?.deletedAt).toBeInstanceOf(Date);
    const del2 = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/${id2}`,
      headers: a.owner,
    });
    expect(del2.statusCode).toBe(204);
    expect(await itemRow(id2)).toBeUndefined();
    expect(await exists(second.r2Key)).toBe(false);
  });

  it('writes no audit rows for the same owner mutations', async () => {
    const a = await team();
    const before = (await app.db.select().from(schema.auditLogs)).length;
    const sub = await createSubcategory(a.owner, a.garmentType.id);
    const subId = sub.json().id as string;
    await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/subcategories/${subId}`,
      headers: a.owner,
      payload: { name: 'Renamed' },
    });
    const { res } = await createItem(a.owner, subId);
    const id = res.json().id as string;
    await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/${id}`,
      headers: a.owner,
      payload: { label: 'Owner edit' },
    });
    expect((await itemRow(id))?.updatedByStaffId).toBeNull();
    await app.inject({ method: 'DELETE', url: `/v1/merchant/catalog/${id}`, headers: a.owner });
    expect(await auditsFor(subId)).toEqual([]);
    expect(await auditsFor(id)).toEqual([]);
    expect((await app.db.select().from(schema.auditLogs)).length).toBe(before);
  });

  it('staff import of a completed studio job is audited', async () => {
    const a = await team();
    const sub = await createSubcategory(a.owner, a.garmentType.id);
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId: a.m.userId,
        status: 'COMPLETED',
        completedAt: new Date(),
        creditsCharged: 1,
      })
      .returning();
    const resultKey = keys.output(job!.id);
    await app.storage.putObject(resultKey, Buffer.from('result'), 'image/jpeg');
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: job!.id, resultKey, thumbnailKey: null });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/import',
      headers: a.s.auth,
      payload: { jobId: job!.id, subcategoryId: sub.json().id },
    });
    expect(res.statusCode).toBe(201);
    const audits = await auditsFor(res.json().id);
    expect(audits.map((r) => [r.action, r.actorRole])).toEqual([
      ['merchant_catalog.import', 'MERCHANT_STAFF'],
    ]);
  });
});

describe('catalogue routes: staff generate', () => {
  async function seedGenerateDefaults(genderSlug: 'women') {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `regular-wf-${randomUUID()}`,
        label: 'Regular workflow',
        jsonContent: {},
        faceNodeId: '1',
        poseNodeId: '1',
        bgNodeId: '1',
        upperNodeIds: ['2'],
        facePhasePromptNode: '1',
        garmentPhasePromptNode: '1',
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Pose ${randomUUID()}`,
        r2Key: 'poses/seed/pose.jpg',
        thumbnailKey: 'poses/seed/pose.thumb.jpg',
        genderSlug,
        workflowTemplateId: wf!.id,
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: genderSlug,
        label: `Face ${randomUUID()}`,
        r2Key: 'faces/seed/face.jpg',
        thumbnailKey: 'faces/seed/face.thumb.jpg',
      })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        label: `Background ${randomUUID()}`,
        r2Key: 'backgrounds/seed/bg.jpg',
        thumbnailKey: 'backgrounds/seed/bg.thumb.jpg',
      })
      .returning();
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug,
        slug: `type-${randomUUID()}`,
        label: 'Type',
        defaultPoseId: pose!.id,
      })
      .returning();
    await app.redis.set(
      'config:system',
      JSON.stringify({
        merchantCatalogDefaults: { [genderSlug]: { faceId: face!.id, backgroundId: bg!.id } },
        merchantCatalogAspectRatio: '2:3',
      }),
    );
    return garmentType!;
  }

  it("staff generate and generate-bulk create jobs on the merchant's wallet carrying staff and branch", async () => {
    const a = await team();
    // Three generations at the configured tier cost exceed the default 100-credit wallet.
    await a.m.credits(1000);
    const garmentType = await seedGenerateDefaults('women');
    const sub = await createSubcategory(a.s.auth, garmentType.id);
    expect(sub.statusCode).toBe(201);
    const subcategoryId = sub.json().id as string;

    const flatImageKey = await presignPut(a.s.auth, 'flat');
    const gen = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/generate',
      headers: a.s.auth,
      payload: { subcategoryId, flatImageKey },
    });
    expect(gen.statusCode).toBe(201);
    const { jobId } = gen.json() as { jobId: string };
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.userId).toBe(a.m.userId);
    expect(job?.staffId).toBe(a.s.staffId);
    expect(job?.branchId).toBe(a.b.id);
    expect(job?.deviceId).toBeNull();
    expect((await auditsFor(jobId)).map((r) => [r.action, r.actorRole])).toEqual([
      ['merchant_catalog.generate', 'MERCHANT_STAFF'],
    ]);

    const status = await app.inject({
      method: 'GET',
      url: `/v1/merchant/catalog/generate/${jobId}`,
      headers: a.s.auth,
    });
    expect(status.statusCode).toBe(200);

    const bulkKey = await presignPut(a.s.auth, 'flat');
    const bulk = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/generate-bulk',
      headers: a.s.auth,
      payload: { subcategoryId, flatImageKeys: [bulkKey] },
    });
    expect(bulk.statusCode).toBe(201);
    const [bulkJobId] = bulk.json().jobIds as string[];
    const [bulkJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, bulkJobId!));
    expect(bulkJob?.staffId).toBe(a.s.staffId);
    expect(bulkJob?.branchId).toBe(a.b.id);
    expect((await auditsFor(bulkJobId!)).map((r) => r.action)).toEqual([
      'merchant_catalog.generate',
    ]);

    // Owner generate stays unattributed and unaudited.
    const ownerKey = await presignPut(a.owner, 'flat');
    const ownerGen = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/generate',
      headers: a.owner,
      payload: { subcategoryId, flatImageKey: ownerKey },
    });
    expect(ownerGen.statusCode).toBe(201);
    const ownerJobId = ownerGen.json().jobId as string;
    const [ownerJob] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, ownerJobId));
    expect(ownerJob?.staffId).toBeNull();
    expect(ownerJob?.branchId).toBeNull();
    expect(await auditsFor(ownerJobId)).toEqual([]);
  });
});
