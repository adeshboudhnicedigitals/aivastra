import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('jobs-sse', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function getToken() {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'sse@x.com', password: 'password123' },
    });
    return res.json().accessToken;
  }

  it('GET /v1/jobs/:id/events returns SSE headers', async () => {
    const token = await getToken();
    const address = app.server.address() as { port: number };
    return new Promise<void>((resolve, reject) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/v1/jobs/550e8400-e29b-41d4-a716-446655440000/events',
          headers: { authorization: `Bearer ${token}` },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          req.destroy();
          resolve();
        },
      );
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(e);
      });
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 500);
    });
  }, 10000);
});
