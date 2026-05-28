import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('uploads', () => {
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
      payload: { email: 'upload@x.com', password: 'password123' },
    });
    return res.json().accessToken;
  }

  it('POST /v1/uploads/presign returns presigned URL with 5min expiry', async () => {
    const token = await getToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/uploads/presign',
      headers: { authorization: `Bearer ${token}` },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toContain('http');
    expect(body.r2Key).toMatch(/^inputs\/[a-f0-9-]+\/garment\.jpg$/);
    expect(body.expiresIn).toBe(300);
  });
});
