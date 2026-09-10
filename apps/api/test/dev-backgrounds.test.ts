import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestApiKey, createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let key: string;
let merchantUserId: string;
let validJpeg: Buffer;

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

function generateBody(overrides: Record<string, unknown> = {}) {
  return {
    garment: jpegBytes().toString('base64'),
    gender: 'women',
    face: 'women-model-a',
    looks: [{ pose: 'front-standing', background: 'studio-white' }],
    aspectRatio: '3:4',
    resolution: '2K',
    ...overrides,
  };
}

const postGenerate = (body: unknown, token = key) =>
  fetch(`${base}/v1/dev/catalog/generate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  validJpeg = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();

  const m = await createTestMerchant(app, { balance: 1000 });
  merchantUserId = m.userId;
  ({ key } = await createTestApiKey(app, m.merchantId));

  await app.db.insert(schema.modelFaces).values({
    gender: 'women',
    label: 'Model A',
    thumbnailKey: 'f-a-t.jpg',
    r2Key: 'f-a.jpg',
    isActive: true,
    publicApiSlug: 'women-model-a',
  });

  await app.db.insert(schema.modelBackgrounds).values({
    label: 'Studio White',
    r2Key: 'bg.jpg',
    thumbnailKey: 'bg-t.jpg',
    bgComfyR2Key: 'bg-comfy.jpg',
    isActive: true,
    scope: 'general',
    publicApiSlug: 'studio-white',
  });

  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'dev-backgrounds-wf',
      label: 'WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: ['1'],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();

  await app.db.insert(schema.modelPoseAssets).values({
    genderSlug: 'women',
    label: 'Front Standing',
    displayName: 'Front Standing',
    r2Key: 'pose.jpg',
    thumbnailKey: 'pose-t.jpg',
    isActive: true,
    scope: 'general',
    workflowTemplateId: wf.id,
    publicApiSlug: 'front-standing',
  });
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('/v1/dev/backgrounds', () => {
  it('requires a full-scope API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dev/backgrounds' });
    expect(res.statusCode).toBe(401);
  });

  it('presign -> confirm creates a scope=user row owned by the merchant, visible via the list route', async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(presign.statusCode).toBe(200);
    const { r2Key } = presign.json() as { r2Key: string };
    expect(r2Key).toBe(`user-backgrounds/${merchantUserId}/${r2Key.split('/')[2]}`);
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key, label: 'Client Wall' },
    });
    expect(confirm.statusCode).toBe(200);
    const created = confirm.json();
    expect(created.id).toBeTruthy();
    expect(created.thumbnailUrl).toContain('http');

    const [row] = await app.db
      .select()
      .from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.id, created.id));
    expect(row?.scope).toBe('user');
    expect(row?.userId).toBe(merchantUserId);
    expect(row?.label).toBe('Client Wall');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/dev/backgrounds',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(list.json().items.map((i: { id: string }) => i.id)).toContain(created.id);
  });

  it('confirm rejects an r2Key not owned by the calling merchant', async () => {
    const other = await createTestMerchant(app, { balance: 10 });
    const { key: otherKey } = await createTestApiKey(app, other.merchantId);

    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${otherKey}` },
      payload: { r2Key },
    });
    expect(confirm.statusCode).toBe(403);
  });

  it('owner can delete; a different merchant gets 404; deleted row disappears from the list', async () => {
    const other = await createTestMerchant(app, { balance: 10 });
    const { key: otherKey } = await createTestApiKey(app, other.merchantId);

    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key },
    });
    const { id } = confirm.json();

    const deleteAsOther = await app.inject({
      method: 'DELETE',
      url: `/v1/dev/backgrounds/${id}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(deleteAsOther.statusCode).toBe(404);

    const deleteAsOwner = await app.inject({
      method: 'DELETE',
      url: `/v1/dev/backgrounds/${id}`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(deleteAsOwner.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/dev/backgrounds',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(list.json().items.map((i: { id: string }) => i.id)).not.toContain(id);
  });

  it('confirm rejects an uploaded object larger than the admin-configured cap', async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };

    // devApiMaxBytes defaults to 20MB — same admin-tunable limit catalog/generate's
    // `garment` field uses; the presigned PUT never enforces contentLength at R2, so
    // simulate an over-cap upload directly, matching the platform-user test's approach.
    const oversized = Buffer.alloc(21 * 1024 * 1024, 1);
    await app.storage.putObject(r2Key, oversized, 'image/jpeg');

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key },
    });
    expect(confirm.statusCode).toBe(400);
  });
});

describe('POST /v1/dev/catalog/generate with a merchant-uploaded background', () => {
  it("resolves the caller's own uploaded background id as a valid looks[].background slug", async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key },
    });
    const { id: backgroundId } = confirm.json();

    const res = await postGenerate(
      generateBody({ looks: [{ pose: 'front-standing', background: backgroundId }] }),
    );
    const body = (await res.json()) as { catalogueId?: string; error?: { code: string } };
    expect(res.status, JSON.stringify(body)).toBe(202);
  });

  it("rejects a different merchant's background id as an unknown slug", async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key },
    });
    const { id: backgroundId } = confirm.json();

    const other = await createTestMerchant(app, { balance: 1000 });
    const { key: otherKey } = await createTestApiKey(app, other.merchantId);

    const res = await postGenerate(
      generateBody({ looks: [{ pose: 'front-standing', background: backgroundId }] }),
      otherKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_SLUG');
  });

  it('rejects a soft-deleted background of its own owner', async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/presign',
      headers: { authorization: `Bearer ${key}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presign.json() as { r2Key: string };
    await app.storage.putObject(r2Key, validJpeg, 'image/jpeg');
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/dev/backgrounds/confirm',
      headers: { authorization: `Bearer ${key}` },
      payload: { r2Key },
    });
    const { id: backgroundId } = confirm.json();

    await app.inject({
      method: 'DELETE',
      url: `/v1/dev/backgrounds/${backgroundId}`,
      headers: { authorization: `Bearer ${key}` },
    });

    const res = await postGenerate(
      generateBody({ looks: [{ pose: 'front-standing', background: backgroundId }] }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_SLUG');
  });
});
