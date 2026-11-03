import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/v1/me/avatar', () => {
  let c: Containers;
  let app: TestApp;
  let png: Buffer;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    png = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function getUser(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token, userId: user.id };
  }

  async function upload(token: string, bytes: Buffer) {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/presign',
      headers: { authorization: `Bearer ${token}` },
      payload: { contentType: 'image/png', contentLength: bytes.length },
    });
    expect(presign.statusCode).toBe(200);
    const { key } = presign.json() as { key: string };
    await app.storage.putObject(key, bytes, 'image/png');
    return key;
  }

  it('presign -> confirm stores a square JPEG and /v1/me returns a signed URL', async () => {
    const { token, userId } = await getUser('avatar1@x.com');
    const key = await upload(token, png);
    expect(key.startsWith(`user-avatars/${userId}/`)).toBe(true);

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { key },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().avatarUrl).toContain('http');

    const meta = await sharp(await app.storage.getObject(key)).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([512, 512]);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().avatarUrl).toContain('http');
    expect(me.json()).not.toHaveProperty('avatarKey');
  });

  it('replacing the picture deletes the old object; DELETE clears it', async () => {
    const { token, userId } = await getUser('avatar2@x.com');
    const first = await upload(token, png);
    await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: first },
    });
    const second = await upload(token, png);
    await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: second },
    });
    await expect(app.storage.headObject(first)).rejects.toBeTruthy();

    const del = await app.inject({
      method: 'DELETE',
      url: '/v1/me/avatar',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    const [row] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(row?.avatarKey).toBeNull();
    await expect(app.storage.headObject(second)).rejects.toBeTruthy();
  });

  it('confirm rejects a key issued to someone else', async () => {
    const { token: a } = await getUser('avatar3a@x.com');
    const { token: b } = await getUser('avatar3b@x.com');
    const key = await upload(a, png);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/confirm',
      headers: { authorization: `Bearer ${b}` },
      payload: { key },
    });
    expect(res.statusCode).toBe(403);
  });

  it('confirm rejects bytes that are not an image', async () => {
    const { token } = await getUser('avatar4@x.com');
    const key = await upload(token, Buffer.from('not an image at all'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/avatar/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { key },
    });
    expect(res.statusCode).toBe(400);
  });
});
