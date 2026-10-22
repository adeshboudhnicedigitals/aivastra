import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin pose assets: WhatsApp pool flag', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  let poseId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `PoolPose${Date.now()}`,
        genderSlug: 'men',
        shotType: 'full',
        r2Key: `pool-pose-${Date.now()}.jpg`,
        thumbnailKey: `pool-pose-${Date.now()}.thumb.jpg`,
      })
      .returning();
    poseId = pose.id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('defaults to false and is listed', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/assets/pose-assets', headers });
    expect(res.statusCode).toBe(200);
    const row = res.json().items.find((i: { id: string }) => i.id === poseId);
    expect(row.whatsappPool).toBe(false);
  });

  it('PATCH toggles it on and off', async () => {
    const on = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/pose-assets/${poseId}`,
      headers,
      payload: { whatsappPool: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().whatsappPool).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/admin/assets/pose-assets', headers });
    expect(list.json().items.find((i: { id: string }) => i.id === poseId).whatsappPool).toBe(true);

    const off = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/pose-assets/${poseId}`,
      headers,
      payload: { whatsappPool: false },
    });
    expect(off.json().whatsappPool).toBe(false);
  });
});
