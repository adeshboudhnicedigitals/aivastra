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

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

function form(categorySlug: string) {
  const fd = new FormData();
  fd.set('category', categorySlug);
  fd.set('person', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'p.jpg');
  fd.set('garment', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'g.jpg');
  return fd;
}

const post = (fd: FormData, token: string) =>
  fetch(`${base}/v1/dev/tryon`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });

describe('per-merchant job creation rate limit', () => {
  it('rejects the request that crosses the merchant-configured limit with 429', async () => {
    const m = await createTestMerchant(app, { balance: 1000, jobRateLimitPerMin: 2 });
    const { key } = await createTestApiKey(app, m.merchantId);
    const { categoryId: _categoryId, workflowTemplateId: _wf } = await createTestDevTryonCategory(
      app,
      {
        slug: `rl-${m.merchantId}`,
      },
    );

    let last: Response | undefined;
    for (let i = 0; i < 3; i++) last = await post(form(`rl-${m.merchantId}`), key);
    expect(last?.status).toBe(429);
    if (!last) throw new Error('no response');
    const body = await last.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('does not throttle a different merchant sharing the same window', async () => {
    const m1 = await createTestMerchant(app, { balance: 1000, jobRateLimitPerMin: 1 });
    const m2 = await createTestMerchant(app, { balance: 1000, jobRateLimitPerMin: 1 });
    const { key: key1 } = await createTestApiKey(app, m1.merchantId);
    const { key: key2 } = await createTestApiKey(app, m2.merchantId);
    await createTestDevTryonCategory(app, { slug: `rl2-${m1.merchantId}` });
    await createTestDevTryonCategory(app, { slug: `rl2-${m2.merchantId}` });

    expect((await post(form(`rl2-${m1.merchantId}`), key1)).status).toBe(202);
    expect((await post(form(`rl2-${m2.merchantId}`), key2)).status).toBe(202);
  });
});
