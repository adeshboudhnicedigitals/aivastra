import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const REGISTRY_KEY = 'worker:registry';

describe('PATCH /admin/workers/:id — registry status sync', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function createWorker(id: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: { id, label: '', url: 'https://example.com/', apiKey: 'k'.repeat(8) },
    });
    expect(res.statusCode).toBe(201);
  }

  async function registryStatus(id: string): Promise<string | undefined> {
    const raw = await app.redis.hget(REGISTRY_KEY, id);
    if (!raw) return undefined;
    return (JSON.parse(raw) as { status?: string }).status;
  }

  it('isActive:false sets registry status to DRAINING', async () => {
    const id = 'test-worker-drain';
    await createWorker(id);
    expect(await registryStatus(id)).toBe('IDLE');

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/workers/${id}`,
      headers: authHeader,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DRAINING');
    expect(await registryStatus(id)).toBe('DRAINING');
  });

  it('isActive:false -> true transition resets registry status DRAINING -> IDLE', async () => {
    const id = 'test-worker-reactivate';
    await createWorker(id);

    await app.inject({
      method: 'PATCH',
      url: `/admin/workers/${id}`,
      headers: authHeader,
      payload: { isActive: false },
    });
    expect(await registryStatus(id)).toBe('DRAINING');

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/workers/${id}`,
      headers: authHeader,
      payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('IDLE');
    expect(await registryStatus(id)).toBe('IDLE');
  });

  it('does not overwrite a BUSY worker back to IDLE when reactivated (isActive:true)', async () => {
    // A worker can't legitimately be BUSY while DRAINING today (selector.ts only claims
    // IDLE workers), but the reactivate branch stays defensive and must never stomp BUSY.
    const id = 'test-worker-busy';
    await createWorker(id);

    const raw = await app.redis.hget(REGISTRY_KEY, id);
    if (!raw) throw new Error('registry entry missing after create');
    const entry = JSON.parse(raw) as Record<string, unknown>;
    entry.status = 'BUSY';
    await app.redis.hset(REGISTRY_KEY, id, JSON.stringify(entry));

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/workers/${id}`,
      headers: authHeader,
      payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('BUSY');
    expect(await registryStatus(id)).toBe('BUSY');
  });
});

describe('POST /admin/workers — allowedJobTypes validation', () => {
  let c: Containers;
  let app: TestApp;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('accepts merchant as an allowed job type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: {
        id: 'test-worker-merchant-pool',
        label: '',
        url: 'https://example.com/',
        apiKey: 'k'.repeat(8),
        allowedJobTypes: ['merchant'],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().allowedJobTypes).toEqual(['merchant']);
  });

  it('rejects an unknown job type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: {
        id: 'test-worker-bad-pool',
        label: '',
        url: 'https://example.com/',
        apiKey: 'k'.repeat(8),
        allowedJobTypes: ['not-a-real-pool'],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts merchant as an allowed job type via PATCH', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: {
        id: 'test-worker-merchant-pool-patch',
        label: '',
        url: 'https://example.com/',
        apiKey: 'k'.repeat(8),
        allowedJobTypes: [],
      },
    });
    expect(createRes.statusCode).toBe(201);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/workers/test-worker-merchant-pool-patch',
      headers: authHeader,
      payload: { allowedJobTypes: ['merchant'] },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().allowedJobTypes).toEqual(['merchant']);
  });

  it('PUT /queue-gate toggles the dispatcher routing flag and lists it, and delete clears it', async () => {
    const id = 'test-worker-queue-gate';
    const created = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: { id, label: '', url: 'https://example.com/', apiKey: 'k'.repeat(8) },
    });
    expect(created.statusCode).toBe(201);
    const listed = async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: authHeader });
      return (res.json() as Array<{ id: string; queueGateEnabled: boolean }>).find(
        (w) => w.id === id,
      )?.queueGateEnabled;
    };
    expect(await listed()).toBe(false);

    const on = await app.inject({
      method: 'PUT',
      url: `/admin/workers/${id}/queue-gate`,
      headers: authHeader,
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect(JSON.parse((await app.redis.get(`worker:routing-config:${id}`)) ?? '{}')).toEqual({
      queueGateEnabled: true,
    });
    expect(await listed()).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/workers/${id}`,
      headers: authHeader,
    });
    expect(del.statusCode).toBe(204);
    expect(await app.redis.get(`worker:routing-config:${id}`)).toBeNull();
  });

  it('PUT /queue-gate 404s for an unknown worker', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/workers/does-not-exist/queue-gate',
      headers: authHeader,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists the ComfyUI queue snapshot and a routing verdict (healthy but never routable is explainable)', async () => {
    const id = 'test-worker-routing-state';
    const created = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: { id, label: '', url: 'https://example.com/', apiKey: 'k'.repeat(8) },
    });
    expect(created.statusCode).toBe(201);
    const routing = async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: authHeader });
      const w = (res.json() as Array<{ id: string; routing: string; queue: unknown }>).find(
        (x) => x.id === id,
      );
      return w;
    };

    await app.redis.setex(`worker:health:${id}`, 30, '1');
    // Gate off → routing ignores ComfyUI's queue.
    expect((await routing())?.routing).toBe('ungated');

    await app.redis.set(`worker:routing-config:${id}`, JSON.stringify({ queueGateEnabled: true }));
    // Gate on, no snapshot (monitor not sampling / probe failing) → healthy but unroutable.
    expect((await routing())?.routing).toBe('unavailable');

    const snap = { queueRemaining: 2, running: 1, pending: 1, probedAt: Date.now() };
    await app.redis.setex(`worker:queue:${id}`, 60, JSON.stringify(snap));
    const busy = await routing();
    expect(busy?.routing).toBe('externally_busy');
    expect(busy?.queue).toMatchObject({ queueRemaining: 2 });

    await app.redis.setex(`worker:queue:${id}`, 60, JSON.stringify({ ...snap, queueRemaining: 0 }));
    expect((await routing())?.routing).toBe('ok');

    await app.redis.setex(
      `worker:queue:${id}`,
      60,
      JSON.stringify({
        queueRemaining: null,
        running: null,
        pending: null,
        probedAt: 1,
        error: 'x',
      }),
    );
    expect((await routing())?.routing).toBe('unavailable');
  });
});
