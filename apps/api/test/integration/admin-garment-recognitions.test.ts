import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// WhatsApp garment recognition records (plan 5 Task 4b, D54): the lane writes
// one garment_recognitions row per request; admin gets a read-only list with
// the photo plus a detail view. Same permission as the admin Jobs list.
describe('admin garment recognitions', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };

  const row = (
    id: string,
    outcome: 'answered' | 'no_worker' | 'failed',
    createdAt: string,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    gender: 'women',
    garmentKey: `inputs/${id}/garment.jpg`,
    options: [
      { slug: 'wa-kurti', label: 'Kurti' },
      { slug: 'wa-full-shirt', label: 'Full shirt' },
    ],
    answer: outcome === 'answered' ? 'wa-kurti' : null,
    outcome,
    ms: outcome === 'answered' ? 1200 : 5,
    workerId: outcome === 'answered' ? 'classify-w1' : null,
    createdAt: new Date(createdAt),
    ...over,
  });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    await app.db
      .insert(schema.garmentRecognitions)
      .values([
        row(ids.a, 'answered', '2026-10-10T00:00:00.000Z'),
        row(ids.b, 'no_worker', '2026-10-11T00:00:00.000Z', { gender: 'men' }),
        row(ids.c, 'failed', '2026-10-12T00:00:00.000Z'),
      ]);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('lists newest first, paginated with a cursor', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/admin/garment-recognitions?limit=2',
      headers,
    });
    expect(first.statusCode).toBe(200);
    const page1 = first.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page1.items.map((i) => i.id)).toEqual([ids.c, ids.b]);
    expect(page1.nextCursor).toBe(ids.b);

    const second = await app.inject({
      method: 'GET',
      url: `/admin/garment-recognitions?limit=2&cursor=${page1.nextCursor}`,
      headers,
    });
    expect(second.statusCode).toBe(200);
    const page2 = second.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page2.items.map((i) => i.id)).toEqual([ids.a]);
    expect(page2.nextCursor).toBeNull();
  });

  it('filters by outcome', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/garment-recognitions?outcome=no_worker',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; outcome: string }> };
    expect(body.items.map((i) => i.id)).toEqual([ids.b]);
    expect(body.items[0]?.outcome).toBe('no_worker');
  });

  it('the list rows carry time, gender, outcome, answer and ms', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/garment-recognitions', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        id: string;
        gender: string;
        outcome: string;
        answer: string | null;
        ms: number;
        createdAt: string;
      }>;
    };
    const newest = body.items[0];
    expect(newest).toMatchObject({ id: ids.c, gender: 'women', outcome: 'failed', ms: 5 });
    expect(typeof newest?.createdAt).toBe('string');
  });

  it('detail returns the row plus a presigned photo url', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/garment-recognitions/${ids.a}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      gender: string;
      garmentKey: string;
      options: unknown;
      answer: string | null;
      outcome: string;
      photoUrl: string;
    };
    expect(body).toMatchObject({
      id: ids.a,
      gender: 'women',
      garmentKey: `inputs/${ids.a}/garment.jpg`,
      answer: 'wa-kurti',
      outcome: 'answered',
    });
    expect(body.options).toEqual([
      { slug: 'wa-kurti', label: 'Kurti' },
      { slug: 'wa-full-shirt', label: 'Full shirt' },
    ]);
    expect(typeof body.photoUrl).toBe('string');
    expect(body.photoUrl).toContain('garment.jpg');
  });

  it('detail 404s for an unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/garment-recognitions/${randomUUID()}`,
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-admin caller with 403', async () => {
    const { token } = await createVerifiedUserToken(app, 'plain@x.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/garment-recognitions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // Same permission as the admin Jobs list (jobs.read). SUPPORT ships with it
  // (0167 matrix), so revoke it here — this file owns a fresh database — and
  // the route must refuse. Runs last: it mutates this file's role matrix.
  it('rejects an admin without jobs.read with 403', async () => {
    const support = await adminAuthHeader(app, 'SUPPORT');
    const [perm] = await app.db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.key, 'jobs.read'));
    await app.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.role, 'SUPPORT'),
          eq(schema.rolePermissions.permissionId, perm.id),
        ),
      );
    const res = await app.inject({
      method: 'GET',
      url: '/admin/garment-recognitions',
      headers: support,
    });
    expect(res.statusCode).toBe(403);
  });
});
