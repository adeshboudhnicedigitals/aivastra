import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { createVerifiedUserToken } from './helpers/auth.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestDevTryonCategory } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let token: string;
let userId: string;

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

const post = (fd: FormData, t = token) =>
  fetch(`${base}/v1/extension/tryon`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}` },
    body: fd,
  });

function jsonBody(opts: { category?: string; person?: string; garment?: string } = {}) {
  const b64 = jpegBytes().toString('base64');
  return {
    category: opts.category ?? 'upper',
    person: opts.person ?? b64,
    garment: opts.garment ?? b64,
  };
}

const postJson = (body: unknown, t = token) =>
  fetch(`${base}/v1/extension/tryon`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const balance = async () => {
  const [row] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return row?.balance ?? 0;
};

const setBalance = async (n: number) => {
  await app.db
    .update(schema.userCredits)
    .set({ balance: n })
    .where(eq(schema.userCredits.userId, userId));
};

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  ({ token, userId } = await createVerifiedUserToken(app, `ext-${randomUUID()}@test.com`));
  await app.db.insert(schema.userCredits).values({ userId, balance: 100 });

  await createTestDevTryonCategory(app, { slug: 'upper', name: 'Upper' });
  await createTestDevTryonCategory(app, { slug: 'inactive-cat', name: 'Off', isActive: false });
  await createTestDevTryonCategory(app, {
    slug: 'dead-workflow',
    name: 'Dead WF',
    templateIsActive: false,
  });
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

describe('POST /v1/extension/tryon', () => {
  it('creates a queued job, deducts credits, and writes the extension job shape', async () => {
    const before = await balance();
    const res = await post(form());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('QUEUED');

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
    expect(job?.source).toBe(JOB_SOURCE.EXTENSION_TRYON);
    expect(job?.userId).toBe(userId);
    // Same dispatcher-routing precondition as /v1/dev/tryon: no apiKeyId, no
    // merchantId, personKey in params — routes to processTryonDirectJob.
    expect(job?.apiKeyId).toBeNull();
    expect(job?.merchantId).toBeNull();
    expect(await balance()).toBe(before - job!.creditsCharged);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, body.jobId));
    const params = inputs!.params as Record<string, unknown>;
    expect(params.personKey).toBeTruthy();
    expect(params.workflowTemplateId).toBeTruthy();
    expect(inputs!.upperGarmentKey).toBeTruthy();
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
    const res = await fetch(`${base}/v1/extension/tryon`, { method: 'POST', body: form() });
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

  it('rejects a category whose workflow template is inactive, without moving credits', async () => {
    const before = await balance();
    const res = await post(form({ category: 'dead-workflow' }));
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

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

  it('returns 402 when the user has insufficient credits', async () => {
    await setBalance(0);
    const res = await post(form());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    await setBalance(100);
  });
});

describe('POST /v1/extension/tryon upload limit', () => {
  afterEach(async () => {
    await app.redis.del('config:system');
  });

  it('rejects a garment file above the admin-configured limit', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({ uploadLimits: { webGarmentMaxBytes: 10 } }),
    );
    const res = await post(form({ garment: Buffer.alloc(1024) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('MB limit');
  });
});

describe('POST /v1/extension/tryon (JSON/base64 body)', () => {
  it('creates a queued job', async () => {
    const res = await postJson(jsonBody());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('QUEUED');
  });

  it('accepts a data: URI prefix on the base64 fields', async () => {
    const b64 = jpegBytes().toString('base64');
    const res = await postJson(jsonBody({ person: `data:image/jpeg;base64,${b64}` }));
    expect(res.status).toBe(202);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await fetch(`${base}/v1/extension/tryon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(jsonBody()),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/extension/categories', () => {
  it('lists active categories only', async () => {
    const res = await fetch(`${base}/v1/extension/categories`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const slugs = body.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('upper');
    expect(slugs).not.toContain('inactive-cat');
  });
});

describe('GET /v1/extension/jobs/:id', () => {
  it('returns the job status for its own job', async () => {
    const createRes = await post(form());
    const { jobId } = await createRes.json();

    const res = await fetch(`${base}/v1/extension/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toBe(jobId);
    expect(['QUEUED', 'RUNNING']).toContain(body.status);
  });

  it("404s on another user's job", async () => {
    const createRes = await post(form());
    const { jobId } = await createRes.json();

    const { token: otherToken } = await createVerifiedUserToken(
      app,
      `ext-other-${randomUUID()}@test.com`,
    );
    const res = await fetch(`${base}/v1/extension/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(404);
  });

  it('404s on a non-extension job id', async () => {
    const res = await fetch(`${base}/v1/extension/jobs/${randomUUID()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
