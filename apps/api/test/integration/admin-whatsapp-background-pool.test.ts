import { schema } from '@aivastra/db';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin background WhatsApp pool flag', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  let ids: string[];

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const sfx = Date.now();
    const rows = await app.db
      .insert(schema.modelBackgrounds)
      .values(
        [1, 2].map((n) => ({
          label: `PoolBg${n}-${sfx}`,
          r2Key: `pool-bg-${n}-${sfx}.jpg`,
          thumbnailKey: `pool-bg-${n}-${sfx}-t.jpg`,
        })),
      )
      .returning();
    ids = rows.map((r) => r.id);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const flags = async () =>
    (
      await app.db
        .select({ id: schema.modelBackgrounds.id, f: schema.modelBackgrounds.whatsappPool })
        .from(schema.modelBackgrounds)
        .where(inArray(schema.modelBackgrounds.id, ids))
    )
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((r) => r.f);

  it('defaults to false, PATCH sets one, bulk sets many', async () => {
    expect(await flags()).toEqual([false, false]);

    const one = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/backgrounds/${ids[0]}`,
      headers,
      payload: { whatsappPool: true },
    });
    expect(one.statusCode).toBe(200);
    expect(await flags()).toEqual([true, false]);

    const bulk = await app.inject({
      method: 'PATCH',
      url: '/admin/assets/backgrounds/bulk',
      headers,
      payload: { ids, whatsappPool: true },
    });
    expect(bulk.statusCode).toBe(200);
    expect(await flags()).toEqual([true, true]);

    await app.inject({
      method: 'PATCH',
      url: '/admin/assets/backgrounds/bulk',
      headers,
      payload: { ids, whatsappPool: false },
    });
    expect(await flags()).toEqual([false, false]);

    const listed = await app.inject({ method: 'GET', url: '/admin/assets/backgrounds', headers });
    expect(listed.json().items.find((i: { id: string }) => i.id === ids[0]).whatsappPool).toBe(
      false,
    );
  });
});
