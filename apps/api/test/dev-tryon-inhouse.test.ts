import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import {
  createTestApiKey,
  createTestDevTryonCategory,
  createTestMerchant,
} from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let key: string;
let userId: string;
// Mutable on purpose: the allowlist is an env value read per request, but the user id
// only exists once the merchant is created (after the app is built).
const allowlist: string[] = [];

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const b64 = () => jpegBytes().toString('base64');
const postJson = (body: Record<string, unknown>) =>
  fetch(`${base}/v1/dev/tryon`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'upper', person: b64(), garment: b64(), ...body }),
  });

const balance = async () => {
  const [row] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return row?.balance ?? 0;
};
const addWorker = (id: string, allowedJobTypes: string[]) =>
  app.db.insert(schema.workers).values({
    id,
    label: id,
    url: `http://${id}.test`,
    apiKey: 'k',
    isActive: true,
    allowedJobTypes,
  });

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { INHOUSE_USER_IDS: allowlist });
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const m = await createTestMerchant(app, { balance: 100 });
  userId = m.userId;
  ({ key } = await createTestApiKey(app, m.merchantId));
  await createTestDevTryonCategory(app, { slug: 'upper', name: 'Upper' });
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

describe('POST /v1/dev/tryon with inhouse: true', () => {
  it('rejects an account that is not on the allowlist, without moving credits', async () => {
    const before = await balance();
    const res = await postJson({ inhouse: true });
    expect(res.status).toBe(403);
    expect(await balance()).toBe(before);
  });

  it('fails fast with no inhouse worker configured, without moving credits', async () => {
    allowlist.push(userId);
    // An accept-all worker must not count: inhouse is opt-in per worker.
    await addWorker('open-worker', []);
    const before = await balance();
    const res = await postJson({ inhouse: true });
    expect(res.status).toBe(503);
    expect(await balance()).toBe(before);
  });

  it('rejects pinning an accept-all worker for an inhouse job', async () => {
    await addWorker('inhouse-a', ['inhouse']);
    const res = await postJson({ inhouse: true, primaryWorkerIds: ['open-worker'] });
    expect(res.status).toBe(400);
  });

  it('rejects pinning an inhouse-only worker for a normal job', async () => {
    const res = await postJson({ primaryWorkerIds: ['inhouse-a'] });
    expect(res.status).toBe(400);
  });

  it('enqueues on jobs:inhouse only, charges the account, and flags the job', async () => {
    const [inhouseBefore, normalBefore] = [
      await app.redis.xlen('jobs:inhouse'),
      await app.redis.xlen('jobs:normal'),
    ];
    const before = await balance();
    const res = await postJson({ inhouse: true, primaryWorkerIds: ['inhouse-a'] });
    expect(res.status).toBe(202);
    const { jobId } = await res.json();

    expect(await app.redis.xlen('jobs:inhouse')).toBe(inhouseBefore + 1);
    expect(await app.redis.xlen('jobs:normal')).toBe(normalBefore);
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.queueStream).toBe('inhouse');
    expect(await balance()).toBe(before - (job?.creditsCharged ?? 0));
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect((inputs?.params as Record<string, unknown>).inhouse).toBe(true);
  });

  it('a normal job still rides jobs:normal and carries no inhouse flag', async () => {
    const normalBefore = await app.redis.xlen('jobs:normal');
    const res = await postJson({});
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    expect(await app.redis.xlen('jobs:normal')).toBe(normalBefore + 1);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect((inputs?.params as Record<string, unknown>).inhouse).toBeUndefined();
  });
});
