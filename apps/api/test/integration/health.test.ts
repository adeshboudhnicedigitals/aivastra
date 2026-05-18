import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startContainers, type Containers } from '../helpers/containers';
import { buildTestApp, type TestApp } from '../helpers/api';

describe('health', () => {
  let c: Containers; let app: TestApp;
  beforeAll(async () => { c = await startContainers(); app = await buildTestApp(c); }, 60000);
  afterAll(async () => { await app?.close(); await c?.stop(); });

  it('GET /health returns 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
