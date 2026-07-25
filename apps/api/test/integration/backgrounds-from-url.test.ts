import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('POST /v1/backgrounds/mine/from-url', () => {
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getToken(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'BG URL User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json().accessToken as string;
  }

  it('fetches a public-IP image URL, stores it as scope=user, and returns the item', async () => {
    const token = await getToken('bgfromurl1@x.com');
    const fixture = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(fixture, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': String(fixture.length) },
        }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/backgrounds/mine/from-url',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'http://1.1.1.1/photo.jpg' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.thumbnailUrl).toContain('http');

    const [row] = await app.db
      .select()
      .from(schema.modelBackgrounds)
      .where(eq(schema.modelBackgrounds.id, body.id));
    expect(row?.scope).toBe('user');
  });

  it('rejects a URL resolving to a private/loopback address without calling fetch', async () => {
    const token = await getToken('bgfromurl2@x.com');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/backgrounds/mine/from-url',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'http://127.0.0.1/x.jpg' },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-image content-type', async () => {
    const token = await getToken('bgfromurl3@x.com');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('not an image', { status: 200, headers: { 'content-type': 'text/plain' } }),
        ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/backgrounds/mine/from-url',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'http://1.1.1.1/notanimage' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized image via content-length', async () => {
    const token = await getToken('bgfromurl4@x.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(10), {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(20 * 1024 * 1024),
          },
        }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/backgrounds/mine/from-url',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'http://1.1.1.1/big.jpg' },
    });
    expect(res.statusCode).toBe(413);
  });
});
