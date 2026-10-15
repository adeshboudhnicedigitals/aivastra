import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Admin "Classify Service" page: status + logs come from the service, stats from
// garment_recognitions. The key never leaves the api.
describe('admin classify service', () => {
  let c: Containers;
  let unconfigured: TestApp;
  let app: TestApp;
  let svc: Server;
  let svcUrl: string;
  let headers: Record<string, string>;
  const KEY = 'svc-secret-key';
  const authSeen: (string | undefined)[] = [];

  beforeAll(async () => {
    svc = createServer((req, res) => {
      authSeen.push(req.headers.authorization);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') {
        res.end(
          JSON.stringify({
            status: 'ok',
            model: 'qwen-test',
            uptime_s: 12,
            vram_allocated_mib: 100,
          }),
        );
      } else if (req.url?.startsWith('/logs')) {
        if (req.headers.authorization !== `Bearer ${KEY}`) {
          res.statusCode = 401;
          res.end('{}');
        } else {
          res.end(JSON.stringify({ items: [{ ts: 1, level: 'INFO', msg: 'classified' }] }));
        }
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise<void>((r) => svc.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(svc.address() as AddressInfo).port}/`;
    svcUrl = url;

    c = await startContainers();
    app = await buildTestApp(c, { CLASSIFY_SERVICE_URL: url, CLASSIFY_SERVICE_API_KEY: KEY });
    unconfigured = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');

    const now = Date.now();
    const row = (outcome: 'answered' | 'failed' | 'no_worker', ms: number, ageH: number) => {
      const id = randomUUID();
      return {
        id,
        gender: 'men',
        garmentKey: `inputs/${id}/g.jpg`,
        options: [{ slug: 'm-kurta', label: 'Kurta' }],
        answer: outcome === 'answered' ? 'm-kurta' : null,
        outcome,
        ms,
        createdAt: new Date(now - ageH * 3_600_000),
      };
    };
    await app.db.insert(schema.garmentRecognitions).values([
      row('answered', 100, 1),
      row('answered', 300, 2),
      row('failed', 5, 3),
      row('answered', 9000, 100), // outside a 24 h window
    ]);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await unconfigured?.close();
    await c?.stop();
    await new Promise<void>((r) => svc.close(() => r()));
  });

  it('status reports the service, its host only, and never the key', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/classify-service/status', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      configured: true,
      reachable: true,
      error: null,
      health: { model: 'qwen-test' },
    });
    expect(body.host).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(res.body).not.toContain(KEY);
  });

  it('status says not configured when the env vars are unset', async () => {
    const h = await adminAuthHeader(unconfigured, 'SUPER_ADMIN');
    const res = await unconfigured.inject({
      method: 'GET',
      url: '/admin/classify-service/status',
      headers: h,
    });
    expect(res.json()).toMatchObject({
      configured: false,
      reachable: false,
      error: 'not_configured',
    });
  });

  it('logs are fetched with the bearer key', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/classify-service/logs', headers });
    expect(res.json()).toEqual({
      items: [{ ts: 1, level: 'INFO', msg: 'classified' }],
      error: null,
    });
    expect(authSeen).toContain(`Bearer ${KEY}`);
  });

  it('stats count the window only, with latency over answered requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/classify-service/stats?hours=24',
      headers,
    });
    const body = res.json();
    expect(body).toMatchObject({ hours: 24, total: 3, counts: { answered: 2, failed: 1 } });
    expect(body.p50Ms).toBe(200);
    expect(body.p95Ms).toBeGreaterThanOrEqual(280);
    expect(body.lastAnsweredAt).toEqual(expect.any(String));
  });

  describe('saved config', () => {
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/admin/classify-service/config', headers, payload });

    it('starts from the env fallback and never returns the key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/classify-service/config',
        headers,
      });
      expect(res.json()).toMatchObject({ source: 'env', apiKeyHint: '...et-key' });
      expect(res.body).not.toContain(KEY);
    });

    it('test-connection: good key, bad key, and a blank key uses the stored one', async () => {
      const url = svcUrl;
      const test = (payload: Record<string, unknown>) =>
        app.inject({
          method: 'POST',
          url: '/admin/classify-service/test-connection',
          headers,
          payload,
        });
      expect((await test({ url, apiKey: KEY })).json()).toMatchObject({
        ok: true,
        model: 'qwen-test',
      });
      expect((await test({ url, apiKey: 'wrong' })).json()).toMatchObject({
        ok: false,
        error: expect.stringContaining('rejected'),
      });
      // no key typed → falls back to the env key here (nothing saved yet)
      expect((await test({ url })).json()).toMatchObject({ ok: true });
      expect((await test({ url: 'http://127.0.0.1:1' })).json()).toMatchObject({ ok: false });
    });

    it('saves, audits the hint only, keeps the key when blank, and clear falls back to env', async () => {
      const saved = await put({ url: `${svcUrl}`, apiKey: KEY });
      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain(KEY);

      let cfg = (
        await app.inject({ method: 'GET', url: '/admin/classify-service/config', headers })
      ).json();
      expect(cfg.source).toBe('db');

      // blank key = keep the stored one
      expect((await put({ url: svcUrl })).statusCode).toBe(200);
      const [row] = await app.db.select().from(schema.classifyServiceConfig);
      expect(row?.apiKey).toBe(KEY);

      const audits = await app.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.resourceType, 'classify_service'));
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audits)).not.toContain(KEY);

      await app.inject({ method: 'DELETE', url: '/admin/classify-service/config', headers });
      cfg = (
        await app.inject({ method: 'GET', url: '/admin/classify-service/config', headers })
      ).json();
      expect(cfg.source).toBe('env');
    });

    it('rejects a save with no key anywhere', async () => {
      const h = await adminAuthHeader(unconfigured, 'SUPER_ADMIN');
      const res = await unconfigured.inject({
        method: 'PUT',
        url: '/admin/classify-service/config',
        headers: h,
        payload: { url: svcUrl },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('needs an admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/classify-service/status' });
    expect(res.statusCode).toBe(401);
  });
});
