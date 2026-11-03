import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('/admin/fleet/inventory', () => {
  let c: Containers;
  let app: TestApp;
  let sup: Record<string, string>;
  let adm: Record<string, string>;
  let mod: Record<string, string>;

  const get = (headers?: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/admin/fleet/inventory', headers });
  const call = (method: 'PUT' | 'POST' | 'DELETE', url: string, payload: unknown, headers = sup) =>
    app.inject({
      method,
      url: `/admin/fleet/inventory${url}`,
      headers,
      payload: payload as object,
    });
  const inv = async () => (await get(sup)).json();
  const host = (over = {}) => ({
    label: 'Box 7',
    provider: 'Provider A',
    rented: true,
    monthlyCostUsd: 450.5,
    inventoryVerified: false,
    reason: 'from the provider invoice',
    ...over,
  });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    sup = await adminAuthHeader(app, 'SUPER_ADMIN');
    adm = await adminAuthHeader(app, 'ADMIN');
    mod = await adminAuthHeader(app, 'MODERATOR');
    for (const id of ['inv-w1', 'inv-w2']) {
      const r = await app.inject({
        method: 'POST',
        url: '/admin/workers',
        headers: sup,
        payload: {
          id,
          label: id,
          url: 'https://inv.invalid/',
          apiKey: 'inv-secret-key-0123456789',
        },
      });
      expect(r.statusCode).toBe(201);
    }
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('read needs fleet.view; writes need fleet.operate (SUPER_ADMIN only)', async () => {
    expect((await get(sup)).statusCode).toBe(200);
    expect((await get(adm)).statusCode).toBe(200);
    expect((await get(mod)).statusCode).toBe(403);
    expect((await get()).statusCode).toBe(401);
    expect((await call('PUT', '/hosts/box-x', host(), adm)).statusCode).toBe(403);
    expect((await call('PUT', '/hosts/box-x', host(), mod)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/admin/fleet/inventory/hosts/box-x',
          payload: host(),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('lists every worker, mapped or not, with nothing invented', async () => {
    const body = await inv();
    const w = body.workers.find((x: { workerId: string }) => x.workerId === 'inv-w1');
    expect(w).toMatchObject({ hostId: null, gpuId: null });
    expect(body.hosts).toEqual([]);
  });

  it('creates and updates a host, round-tripping the cost', async () => {
    const r = await call('PUT', '/hosts/box-7', host());
    expect(r.statusCode).toBe(200);
    const h = r.json().hosts.find((x: { id: string }) => x.id === 'box-7');
    expect(h).toMatchObject({
      label: 'Box 7',
      provider: 'Provider A',
      rented: true,
      monthlyCostUsd: 450.5,
      inventoryVerified: false,
      latestReview: null,
    });
    const u = await call(
      'PUT',
      '/hosts/box-7',
      host({
        label: 'Box 7 (verified)',
        monthlyCostUsd: null,
        rented: null,
        provider: '  ',
        inventoryVerified: true,
      }),
    );
    expect(u.json().hosts.find((x: { id: string }) => x.id === 'box-7')).toMatchObject({
      label: 'Box 7 (verified)',
      provider: null,
      rented: null,
      monthlyCostUsd: null,
      inventoryVerified: true,
    });
  });

  it('validates input: slug, reason, cost', async () => {
    expect((await call('PUT', '/hosts/Bad_Id', host())).statusCode).toBe(400);
    expect((await call('PUT', '/hosts/box-7', host({ reason: 'x' }))).statusCode).toBe(400);
    expect((await call('PUT', '/hosts/box-7', host({ monthlyCostUsd: -3 }))).statusCode).toBe(400);
    expect((await call('PUT', '/hosts/box-7', host({ monthlyCostUsd: 1.234 }))).statusCode).toBe(
      400,
    );
  });

  it('a GPU needs an existing host; a worker needs a GPU on its own host', async () => {
    expect(
      (
        await call('PUT', '/gpus/gpu-a', {
          hostId: 'no-such',
          model: 'RTX 4090',
          vramTotalMb: 24576,
          reason: 'seen in nvidia-smi',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PUT', '/gpus/gpu-a', {
          hostId: 'box-7',
          model: 'RTX 4090',
          vramTotalMb: 24576,
          reason: 'seen in nvidia-smi',
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('PUT', '/hosts/box-8', host({ label: 'Box 8' }))).statusCode).toBe(200);
    expect(
      (
        await call('PUT', '/gpus/gpu-b', {
          hostId: 'box-8',
          model: null,
          vramTotalMb: null,
          reason: 'unknown yet',
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await call('PUT', '/workers/inv-w1', {
          hostId: 'box-7',
          gpuId: 'gpu-b',
          reason: 'wrong pairing',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('PUT', '/workers/inv-w1', {
          hostId: 'box-7',
          gpuId: 'ghost',
          reason: 'missing gpu',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('PUT', '/workers/ghost-worker', {
          hostId: 'box-7',
          gpuId: 'gpu-a',
          reason: 'unknown worker',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PUT', '/workers/inv-w1', {
          hostId: 'box-7',
          gpuId: null,
          reason: 'half a mapping',
        })
      ).statusCode,
    ).toBe(400);

    const ok = await call('PUT', '/workers/inv-w1', {
      hostId: 'box-7',
      gpuId: 'gpu-a',
      reason: 'checked on the box',
    });
    expect(ok.statusCode).toBe(200);
    expect(
      ok.json().workers.find((x: { workerId: string }) => x.workerId === 'inv-w1'),
    ).toMatchObject({ hostId: 'box-7', gpuId: 'gpu-a' });
    // Two workers may share one GPU (two ComfyUI instances).
    expect(
      (
        await call('PUT', '/workers/inv-w2', {
          hostId: 'box-7',
          gpuId: 'gpu-a',
          reason: 'second instance',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('refuses to move or delete things that are in use, and says why', async () => {
    const move = await call('PUT', '/gpus/gpu-a', {
      hostId: 'box-8',
      model: 'RTX 4090',
      vramTotalMb: 24576,
      reason: 'trying to move',
    });
    expect(move.statusCode).toBe(409);
    expect(move.json().error.message).toMatch(/mapped workers/);
    expect((await call('DELETE', '/gpus/gpu-a', { reason: 'cleanup attempt' })).statusCode).toBe(
      409,
    );
    const hostDel = await call('DELETE', '/hosts/box-7', { reason: 'cleanup attempt' });
    expect(hostDel.statusCode).toBe(409);
    expect(hostDel.json().error.message).toMatch(/2 mapped workers/);
  });

  it('records reviews append-only and shows the newest', async () => {
    expect((await call('POST', '/hosts/box-7/reviews', { note: 'ok' })).statusCode).toBe(400);
    expect(
      (await call('POST', '/hosts/nope/reviews', { note: 'host does not exist' })).statusCode,
    ).toBe(404);
    await call('POST', '/hosts/box-7/reviews', { note: 'first review: matches invoice' });
    const r = await call('POST', '/hosts/box-7/reviews', {
      note: 'second review: GPU count confirmed',
    });
    const h = r.json().hosts.find((x: { id: string }) => x.id === 'box-7');
    expect(h.latestReview).toMatchObject({ note: 'second review: GPU count confirmed' });
    expect(h.latestReview.reviewedBy).toContain('@');
  });

  it('unmaps workers, then deletes GPUs and (unreviewed) hosts', async () => {
    expect(
      (await call('PUT', '/workers/inv-w1', { hostId: null, gpuId: null, reason: 'box retired' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call('PUT', '/workers/inv-w2', { hostId: null, gpuId: null, reason: 'box retired' }))
        .statusCode,
    ).toBe(200);
    expect((await call('DELETE', '/gpus/gpu-a', { reason: 'box retired' })).statusCode).toBe(200);
    // box-7 has reviews: they are kept, so the host cannot be deleted.
    const kept = await call('DELETE', '/hosts/box-7', { reason: 'box retired' });
    expect(kept.statusCode).toBe(409);
    expect(kept.json().error.message).toMatch(/reviews/);
    // box-8 still has gpu-b.
    expect((await call('DELETE', '/hosts/box-8', { reason: 'no gpu left' })).statusCode).toBe(409);
    expect((await call('DELETE', '/gpus/gpu-b', { reason: 'unused' })).statusCode).toBe(200);
    const done = await call('DELETE', '/hosts/box-8', { reason: 'unused' });
    expect(done.statusCode).toBe(200);
    expect(done.json().hosts.map((x: { id: string }) => x.id)).toEqual(['box-7']);
    expect((await call('DELETE', '/hosts/box-8', { reason: 'again' })).statusCode).toBe(404);
  });

  it('writes audit rows with the reason, visible in the activity log', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/fleet/activity?source=AUDIT&limit=100',
      headers: sup,
    });
    const items = res.json().items as { action: string; actor: string | null; summary: string }[];
    for (const a of [
      'fleet.inventory.host.upsert',
      'fleet.inventory.gpu.upsert',
      'fleet.inventory.worker.map',
      'fleet.inventory.host.review',
      'fleet.inventory.gpu.delete',
      'fleet.inventory.host.delete',
    ]) {
      expect(
        items.some((i) => i.action === a),
        a,
      ).toBe(true);
    }
    expect(items.find((i) => i.action === 'fleet.inventory.host.upsert')?.summary).toMatch(
      // Host events name the box they touched, like worker events do.
      /edited a host on \S+$/,
    );
  });

  it('never exposes worker URLs or keys', async () => {
    const res = await get(sup);
    expect(res.body).not.toContain('inv-secret-key');
    expect(res.body).not.toContain('inv.invalid');
  });
});
