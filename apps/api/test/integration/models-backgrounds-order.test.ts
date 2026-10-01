import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /v1/models/backgrounds ordering', () => {
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

  it('orders by the admin-curated sortOrder, then label — not insert order', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: 'bgorder@x.com', emailVerified: true, tier: 'free' })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);

    // Inserted deliberately out of order.
    const rows = [
      { label: 'Zeta', sortOrder: 1 },
      { label: 'Beta', sortOrder: 5 },
      { label: 'Alpha', sortOrder: 5 },
      { label: 'Omega', sortOrder: 0 },
    ];
    for (const r of rows) {
      await app.db.insert(schema.modelBackgrounds).values({
        label: r.label,
        r2Key: `bg/${r.label}.jpg`,
        thumbnailKey: `bg/${r.label}.thumb.jpg`,
        sortOrder: r.sortOrder,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/backgrounds',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const labels = (res.json() as { items: { label: string }[] }).items.map((i) => i.label);
    expect(labels).toEqual(['Omega', 'Zeta', 'Alpha', 'Beta']);
  });
});
