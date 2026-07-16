import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import {
  createTestApiKey,
  createTestMerchant,
  createTestTryonCategory,
} from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let key: string;
let merchantId: string;
let userId: string;
let setCredits: (n: number) => Promise<void>;

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

function form(
  opts: { category?: string; person?: Buffer; garment?: Buffer; personType?: string } = {},
) {
  const fd = new FormData();
  fd.set('category', opts.category ?? 'upper');
  fd.set(
    'person',
    new Blob([opts.person ?? jpegBytes()], { type: opts.personType ?? 'image/jpeg' }),
    'person.jpg',
  );
  fd.set('garment', new Blob([opts.garment ?? jpegBytes()], { type: 'image/jpeg' }), 'garment.jpg');
  return fd;
}

const post = (fd: FormData, token = key) =>
  fetch(`${base}/v1/dev/tryon`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const m = await createTestMerchant(app, { balance: 100 });
  merchantId = m.merchantId;
  userId = m.userId;
  setCredits = m.credits;
  ({ key } = await createTestApiKey(app, merchantId));

  await createTestTryonCategory(app, { slug: 'upper', name: 'Upper' });
  await createTestTryonCategory(app, { slug: 'inactive-cat', name: 'Off', isActive: false });
  await createTestTryonCategory(app, {
    slug: 'dead-workflow',
    name: 'Dead WF',
    templateIsActive: false,
  });
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

const balance = async () => {
  const [row] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return row?.balance ?? 0;
};

describe('POST /v1/dev/tryon', () => {
  it('creates a queued job, deducts credits, and writes the tryon job shape', async () => {
    const before = await balance();
    const res = await post(form());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('QUEUED');

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
    expect(job?.source).toBe('api');
    expect(job?.merchantId).toBe(merchantId);
    expect(job?.apiKeyId).toBeTruthy();
    expect(await balance()).toBe(before - job!.creditsCharged);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, body.jobId));
    const params = inputs!.params as Record<string, unknown>;
    expect(params.personKey).toBeTruthy();
    expect(params.workflowTemplateId).toBeTruthy();
    expect(inputs!.upperGarmentKey).toBeTruthy();
    // The absence of these is what routes the job to the dispatcher's tryon path.
    expect(inputs!.faceId).toBeNull();
    expect(inputs!.backgroundId).toBeNull();
    expect(inputs!.poseId).toBeNull();
  });

  it('enqueues the job on jobs:normal', async () => {
    const res = await post(form());
    const { jobId } = await res.json();
    const entries = await app.redis.xrange('jobs:normal', '-', '+');
    const ids = entries.flatMap(([, fields]) => {
      const i = fields.indexOf('jobId');
      return i >= 0 ? [fields[i + 1]] : [];
    });
    expect(ids).toContain(jobId);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await fetch(`${base}/v1/dev/tryon`, { method: 'POST', body: form() });
    expect(res.status).toBe(401);
  });

  it('rejects an inactive category with 400 and does not move credits', async () => {
    const before = await balance();
    const res = await post(form({ category: 'inactive-cat' }));
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  it('rejects an unknown category with 400 and does not move credits', async () => {
    const before = await balance();
    const res = await post(form({ category: 'nope' }));
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  // Kill-switch parity: deactivating the workflow template must disable the
  // category even though the category row itself is still active.
  it('rejects a category whose workflow template is inactive, without moving credits', async () => {
    const before = await balance();
    const res = await post(form({ category: 'dead-workflow' }));
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  // Security regression: the declared Content-Type is attacker-controlled, so a
  // shell script announced as image/jpeg must still be rejected on its bytes.
  it('rejects a non-image disguised with an image content-type', async () => {
    const before = await balance();
    const res = await post(
      form({ person: Buffer.from('#!/bin/sh\nrm -rf /', 'utf8'), personType: 'image/jpeg' }),
    );
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  it('rejects a request missing the garment file with 400', async () => {
    const fd = new FormData();
    fd.set('category', 'upper');
    fd.set('person', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'person.jpg');
    expect((await post(fd)).status).toBe(400);
  });

  it('returns 402 when the merchant has insufficient credits', async () => {
    await setCredits(0);
    const res = await post(form());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    await setCredits(100);
  });
});
