import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const H = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('/admin/fleet/operations', () => {
  let c: Containers;
  let app: TestApp;
  let sup: Record<string, string>;
  let adm: Record<string, string>;

  const get = (headers?: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/admin/fleet/operations', headers });
  const call = (method: 'PUT' | 'POST' | 'DELETE', url: string, payload: unknown, headers = sup) =>
    app.inject({
      method,
      url: `/admin/fleet/operations${url}`,
      headers,
      payload: payload as object,
    });
  const window = (over = {}) => ({
    workerId: 'ops-w1',
    startsAt: iso(H),
    endsAt: iso(3 * H),
    owner: 'Srinivas',
    reason: 'driver upgrade',
    ...over,
  });
  const auditRows = (action: string) =>
    app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    sup = await adminAuthHeader(app, 'SUPER_ADMIN');
    adm = await adminAuthHeader(app, 'ADMIN');
    const r = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: sup,
      payload: {
        id: 'ops-w1',
        label: 'ops-w1',
        url: 'https://ops.invalid/',
        apiKey: 'ops-secret-key-0123456789',
      },
    });
    expect(r.statusCode).toBe(201);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('read needs fleet.view; writes need fleet.operate (SUPER_ADMIN only)', async () => {
    expect((await get(sup)).statusCode).toBe(200);
    expect((await get(adm)).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(401);
    expect((await call('POST', '/maintenance', window(), adm)).statusCode).toBe(403);
    expect(
      (await call('PUT', '/reservations/ops-w1', { owner: 'x', until: null, reason: 'abc' }, adm))
        .statusCode,
    ).toBe(403);
  });

  it('schedules a window, audits it, and shows it as SCHEDULED', async () => {
    const res = await call('POST', '/maintenance', window());
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.maintenance).toHaveLength(1);
    expect(body.maintenance[0]).toMatchObject({
      workerId: 'ops-w1',
      owner: 'Srinivas',
      status: 'SCHEDULED',
    });
    const rows = await auditRows('fleet.maintenance.schedule');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.after)).toContain('driver upgrade');
  });

  it('rejects bad windows', async () => {
    const past = await call('POST', '/maintenance', window({ startsAt: iso(-H) }));
    expect(past.statusCode).toBe(400);
    expect(past.json().error.message).toMatch(/future/);
    const backwards = await call('POST', '/maintenance', window({ endsAt: iso(30 * 60_000) }));
    expect(backwards.statusCode).toBe(400);
    const long = await call('POST', '/maintenance', window({ endsAt: iso(30 * 24 * H) }));
    expect(long.statusCode).toBe(400);
    expect(long.json().error.message).toMatch(/14 days/);
    const noReason = await call('POST', '/maintenance', window({ reason: 'ab' }));
    expect(noReason.statusCode).toBe(400);
    const nobody = await call('POST', '/maintenance', window({ workerId: 'nope' }));
    expect(nobody.statusCode).toBe(404);
  });

  it('cancels a window once, with a reason, and keeps it as history', async () => {
    const id = ((await get(sup)).json().maintenance as { id: string }[])[0]?.id as string;
    const missingReason = await call('POST', `/maintenance/${id}/cancel`, { reason: '' });
    expect(missingReason.statusCode).toBe(400);
    const res = await call('POST', `/maintenance/${id}/cancel`, { reason: 'plan changed' });
    expect(res.statusCode).toBe(200);
    expect(res.json().maintenance[0].status).toBe('CANCELLED');
    expect(await auditRows('fleet.maintenance.cancel')).toHaveLength(1);
    const again = await call('POST', `/maintenance/${id}/cancel`, { reason: 'plan changed' });
    expect(again.statusCode).toBe(409);
    expect(await auditRows('fleet.maintenance.cancel')).toHaveLength(1);
    expect(
      (
        await call('POST', '/maintenance/00000000-0000-4000-8000-000000000000/cancel', {
          reason: 'nothing',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('shows an in-progress window as ACTIVE and refuses to cancel a finished one', async () => {
    const [active] = await app.db
      .insert(schema.fleetMaintenanceWindows)
      .values({
        workerId: 'ops-w1',
        startsAt: new Date(Date.now() - H),
        endsAt: new Date(Date.now() + H),
        owner: 'x',
        reason: 'in progress',
      })
      .returning();
    const [ended] = await app.db
      .insert(schema.fleetMaintenanceWindows)
      .values({
        workerId: 'ops-w1',
        startsAt: new Date(Date.now() - 3 * H),
        endsAt: new Date(Date.now() - 2 * H),
        owner: 'x',
        reason: 'done',
      })
      .returning();
    const list = (await get(sup)).json().maintenance as { id: string; status: string }[];
    expect(list.find((w) => w.id === active?.id)?.status).toBe('ACTIVE');
    expect(list.find((w) => w.id === ended?.id)?.status).toBe('ENDED');
    expect(
      (await call('POST', `/maintenance/${ended?.id}/cancel`, { reason: 'too late' })).statusCode,
    ).toBe(409);
    // Cancelling an active window is allowed: it ends the silence immediately.
    expect(
      (await call('POST', `/maintenance/${active?.id}/cancel`, { reason: 'finished early' }))
        .statusCode,
    ).toBe(200);
  });

  it('sets, replaces and releases a reservation note, with audit rows', async () => {
    const set = await call('PUT', '/reservations/ops-w1', {
      owner: 'Design team',
      until: iso(24 * H),
      reason: 'lent for a demo',
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().reservations).toEqual([
      expect.objectContaining({ workerId: 'ops-w1', owner: 'Design team' }),
    ]);
    const replace = await call('PUT', '/reservations/ops-w1', {
      owner: 'QA',
      until: null,
      reason: 'handover',
    });
    expect(replace.json().reservations).toHaveLength(1);
    expect(replace.json().reservations[0]).toMatchObject({ owner: 'QA', until: null });
    const sets = await auditRows('fleet.reservation.set');
    expect(sets).toHaveLength(2);
    expect(JSON.stringify(sets[1]?.before)).toContain('Design team');

    const release = await call('DELETE', '/reservations/ops-w1', { reason: 'demo finished' });
    expect(release.statusCode).toBe(200);
    expect(release.json().reservations).toHaveLength(0);
    expect(await auditRows('fleet.reservation.release')).toHaveLength(1);
    expect((await call('DELETE', '/reservations/ops-w1', { reason: 'again' })).statusCode).toBe(
      404,
    );
  });

  it('rejects a reservation that ends in the past or on a missing worker', async () => {
    const past = await call('PUT', '/reservations/ops-w1', {
      owner: 'x',
      until: iso(-H),
      reason: 'old news',
    });
    expect(past.statusCode).toBe(400);
    const nobody = await call('PUT', '/reservations/nope', {
      owner: 'x',
      until: null,
      reason: 'ghost',
    });
    expect(nobody.statusCode).toBe(404);
  });

  it('a reservation does not change dispatcher state', async () => {
    await call('PUT', '/reservations/ops-w1', { owner: 'x', until: null, reason: 'note only' });
    expect(await app.redis.hget('worker:reservations', 'ops-w1')).toBeNull();
    await call('DELETE', '/reservations/ops-w1', { reason: 'cleanup' });
  });
});
