import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// The catalogue-template editor's upload tiles render the created asset from the
// create response's thumbnailUrl. Without it the upload succeeds but the tile
// falls back to its empty "+ Pose" / "+ Background" state, so the admin retries
// and leaves orphan template-scoped assets behind.
describe('admin asset create responses carry a presigned thumbnailUrl', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('POST /admin/assets/pose-assets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/pose-assets',
      headers,
      payload: {
        label: 'Thumb url pose',
        r2Key: `thumb-url-pose-${Date.now()}.jpg`,
        thumbnailKey: `thumb-url-pose-${Date.now()}.thumb.jpg`,
        genderSlug: 'men',
        scope: 'template',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.thumbnailUrl).toBe('string');
    expect(body.thumbnailUrl).toContain(body.thumbnailKey);
  });

  it('a template-scoped pose whose label is taken gets a numeric suffix instead of a 409', async () => {
    const label = `dup-label-${Date.now()}`;
    const create = (scope: 'template' | 'general') =>
      app.inject({
        method: 'POST',
        url: '/admin/assets/pose-assets',
        headers,
        payload: {
          label,
          r2Key: `${label}-${Math.random()}.jpg`,
          thumbnailKey: `${label}-${Math.random()}.thumb.jpg`,
          genderSlug: 'men',
          scope,
        },
      });

    expect((await create('template')).json().label).toBe(label);
    expect((await create('template')).json().label).toBe(`${label}-2`);
    expect((await create('template')).json().label).toBe(`${label}-3`);
    // General-scope labels are chosen by hand in the Pose Assets tab: still a conflict.
    expect((await create('general')).statusCode).toBe(409);
  });

  it('POST /admin/assets/backgrounds/confirm', async () => {
    const r2Key = `thumb-url-bg-${Date.now()}.jpg`;
    const jpeg = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    await app.storage.putObject(r2Key, jpeg, 'image/jpeg');

    const res = await app.inject({
      method: 'POST',
      url: '/admin/assets/backgrounds/confirm',
      headers,
      payload: { label: 'Thumb url bg', r2Key, sortOrder: 0, genderSlug: 'men', scope: 'template' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.thumbnailUrl).toBe('string');
    expect(body.thumbnailUrl).toContain(body.thumbnailKey);
  });
});
