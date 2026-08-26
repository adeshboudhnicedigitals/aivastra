import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestApiKey, createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(
    c,
    {},
    {
      beforeListen: (a) => {
        a.get(
          '/test/full-only',
          { preHandler: [a.requireApiKey, a.requireDevScope('full')] },
          async (req) => ({ ok: true, scope: req.apiKeyScope, integration: req.integration }),
        );
        a.get('/test/either-scope', { preHandler: a.requireApiKey }, async (req) => ({
          ok: true,
          scope: req.apiKeyScope,
        }));
      },
    },
  );
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

describe('requireDevScope', () => {
  it('decorates the request with the key scope and integration', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, {
      scope: 'widget',
      integration: 'wordpress',
    });
    const res = await fetch(`${base}/test/either-scope`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).scope).toBe('widget');
  });

  it('allows a full-scoped key on a full-only route', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'full' });
    const res = await fetch(`${base}/test/full-only`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a widget-scoped key on a full-only route with 403', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'widget' });
    const res = await fetch(`${base}/test/full-only`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('full-only dev routes reject widget-scoped keys', () => {
  it('rejects GET /v1/dev/me for a widget key with 403', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'widget' });
    const res = await fetch(`${base}/v1/dev/me`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });

  it('allows GET /v1/dev/me for a full key', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'full' });
    const res = await fetch(`${base}/v1/dev/me`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it('rejects POST /v1/dev/saree-mannequin for a widget key with 403', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'widget' });
    const res = await fetch(`${base}/v1/dev/saree-mannequin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ garment: 'aGVsbG8=' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects GET /v1/dev/catalog/options for a widget key with 403', async () => {
    const m = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, m.merchantId, { scope: 'widget' });
    const res = await fetch(`${base}/v1/dev/catalog/options?gender=women`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});
