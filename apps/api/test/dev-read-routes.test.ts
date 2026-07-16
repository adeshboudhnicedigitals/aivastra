import { schema } from '@aivastra/db';
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
let otherKey: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const m = await createTestMerchant(app, { balance: 42 });
  merchantId = m.merchantId;
  userId = m.userId;
  ({ key } = await createTestApiKey(app, merchantId));

  const other = await createTestMerchant(app);
  ({ key: otherKey } = await createTestApiKey(app, other.merchantId));

  await createTestTryonCategory(app, { slug: 'upper', name: 'Upper', sortOrder: 1 });
  await createTestTryonCategory(app, {
    slug: 'hidden',
    name: 'Hidden',
    isActive: false,
    sortOrder: 2,
  });
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

const get = (path: string, token = key) =>
  fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

async function makeJob(status: string, opts: { withOutput?: boolean; errorCode?: string } = {}) {
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      userId,
      merchantId,
      status,
      source: 'api',
      creditsCharged: 1,
      errorCode: opts.errorCode ?? null,
    })
    .returning();
  if (!job) throw new Error('failed to create test job');
  if (opts.withOutput) {
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: job.id, resultKey: `outputs/${job.id}/result.png` });
  }
  return job.id;
}

describe('GET /v1/dev/jobs/:id', () => {
  it('returns QUEUED with no imageUrl', async () => {
    const id = await makeJob('QUEUED');
    const body = await (await get(`/v1/dev/jobs/${id}`)).json();
    expect(body.status).toBe('QUEUED');
    expect(body.imageUrl).toBeUndefined();
  });

  it('returns COMPLETED with a presigned imageUrl', async () => {
    const id = await makeJob('COMPLETED', { withOutput: true });
    const body = await (await get(`/v1/dev/jobs/${id}`)).json();
    expect(body.status).toBe('COMPLETED');
    expect(body.imageUrl).toContain('http');
    // Presigned, not public — must carry a signature and expiry.
    expect(body.imageUrl).toContain('X-Amz-Signature');
  });

  it('returns FAILED with the error code', async () => {
    const id = await makeJob('FAILED', { errorCode: 'COMFY_TIMEOUT' });
    const body = await (await get(`/v1/dev/jobs/${id}`)).json();
    expect(body.status).toBe('FAILED');
    expect(body.error).toBe('COMFY_TIMEOUT');
  });

  // Security: cross-merchant reads must be indistinguishable from nonexistent
  // jobs, or job IDs become an enumeration oracle.
  it("returns 404 for another merchant's job", async () => {
    const id = await makeJob('COMPLETED', { withOutput: true });
    expect((await get(`/v1/dev/jobs/${id}`, otherKey)).status).toBe(404);
  });

  it('returns 404 for an unknown job', async () => {
    const res = await get('/v1/dev/jobs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed id', async () => {
    expect((await get('/v1/dev/jobs/not-a-uuid')).status).toBe(400);
  });
});

describe('GET /v1/dev/categories', () => {
  it('returns only active categories', async () => {
    const body = await (await get('/v1/dev/categories')).json();
    const slugs = body.categories.map((x: { slug: string }) => x.slug);
    expect(slugs).toContain('upper');
    expect(slugs).not.toContain('hidden');
  });

  it('requires a key', async () => {
    expect((await fetch(`${base}/v1/dev/categories`)).status).toBe(401);
  });
});

describe('GET /v1/dev/me', () => {
  it('returns merchant identity and balance', async () => {
    const body = await (await get('/v1/dev/me')).json();
    expect(body.merchantId).toBe(merchantId);
    expect(body.companyName).toBe('Test Co');
    expect(body.credits).toBe(42);
  });
});
