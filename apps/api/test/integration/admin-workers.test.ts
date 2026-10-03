import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

    // Redis test indices are leased and reused; establish this fixture's gate state.
    await app.redis.del(`worker:routing-config:${id}`);
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
  const capabilities = {
    queuePromptIdentityValidated: true,
    queueDeleteValidated: true,
    promptScopedInterruptValidated: true,
    validatedComfyVersion: '0.37.0',
    validatedAt: '2026-10-01',
    validationReference: 'docs/progress.md#local-fixture',
  };
  async function request(
    method: 'PUT' | 'DELETE' | 'PATCH' | 'POST',
    id: string,
    suffix: string,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url: `/admin/workers/${id}${suffix}`,
      headers: authHeader,
      ...(payload === undefined ? {} : { payload }),
    });
  }
  async function capabilityWorker(id: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: authHeader,
      payload: { id, label: '', url: 'http://127.0.0.1:1', apiKey: 'fixture-key' },
    });
    expect(res.statusCode).toBe(201);
  }
  it('guards every capability enablement, allows immediate partial revocation, and audits writes', async () => {
    const id = 'cap-transitions';
    await capabilityWorker(id);
    expect((await request('PUT', id, '/capabilities', capabilities)).statusCode).toBe(409);
    await request('PUT', id, '/queue-gate', { enabled: true });
    expect(
      (
        await request('PUT', id, '/capabilities', {
          ...capabilities,
          validationReference: undefined,
        })
      ).statusCode,
    ).toBe(409);
    expect((await request('PUT', id, '/capabilities', capabilities)).statusCode).toBe(200);
    expect(
      (await request('PUT', id, '/capabilities', { ...capabilities, queueDeleteValidated: false }))
        .statusCode,
    ).toBe(200);
    await app.redis.del(`worker:routing-config:${id}`);
    expect((await request('PUT', id, '/capabilities', capabilities)).statusCode).toBe(409);
    expect(
      (
        await request('PUT', id, '/capabilities', {
          ...capabilities,
          queueDeleteValidated: false,
          validatedAt: '2026-10-02',
        })
      ).statusCode,
    ).toBe(200);
    const { schema } = await import('@aivastra/db');
    const { eq } = await import('drizzle-orm');
    const audits = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, id));
    expect(audits.filter((a) => a.action === 'worker.capabilities')).toHaveLength(3);
  });
  it.each([
    {},
    {
      queuePromptIdentityValidated: false,
      queueDeleteValidated: false,
      promptScopedInterruptValidated: false,
    },
    null,
  ])('complete clear requires draining (%s)', async (next) => {
    const id = `cap-clear-${next === null ? 'delete' : Object.keys(next).length}`;
    await capabilityWorker(id);
    await request('PUT', id, '/queue-gate', { enabled: true });
    await request('PUT', id, '/capabilities', capabilities);
    const clear = () =>
      request(
        next === null ? 'DELETE' : 'PUT',
        id,
        '/capabilities',
        next === null ? undefined : next,
      );
    expect((await clear()).statusCode).toBe(409);
    await request('POST', id, '/drain');
    expect((await clear()).statusCode).toBe(next === null ? 204 : 200);
  });
  it('configured worker requires drain for version changes, gate off and rename; rename moves capabilities', async () => {
    const id = 'cap-rename';
    await capabilityWorker(id);
    await request('PUT', id, '/queue-gate', { enabled: true });
    await request('PUT', id, '/capabilities', capabilities);
    expect(
      (await request('PUT', id, '/capabilities', { ...capabilities, validatedComfyVersion: 'new' }))
        .statusCode,
    ).toBe(409);
    expect((await request('PUT', id, '/queue-gate', { enabled: false })).statusCode).toBe(409);
    expect((await request('PATCH', id, '', { id: 'cap-renamed' })).statusCode).toBe(409);
    await request('POST', id, '/drain');
    expect(
      (await request('PUT', id, '/capabilities', { ...capabilities, validatedComfyVersion: 'new' }))
        .statusCode,
    ).toBe(200);
    await app.redis.set(`worker:comfy-version:${id}`, 'new');
    expect((await request('PATCH', id, '', { id: 'cap-renamed' })).statusCode).toBe(200);
    expect(await app.redis.get(`worker:capabilities:${id}`)).toBeNull();
    expect(await app.redis.get('worker:capabilities:cap-renamed')).not.toBeNull();
    expect(await app.redis.get(`worker:comfy-version:${id}`)).toBeNull();
    expect(
      (await request('PUT', 'cap-renamed', '/queue-gate', { enabled: false })).statusCode,
    ).toBe(200);
  });
  it.each([
    '{',
    '[]',
  ])('unreadable capability state blocks guarded mutations until drained (%s)', async (raw) => {
    const id = `cap-malformed-${raw === '{' ? 'json' : 'shape'}`;
    await capabilityWorker(id);
    await app.redis.set(`worker:capabilities:${id}`, raw);
    expect((await request('PUT', id, '/queue-gate', { enabled: false })).statusCode).toBe(409);
    expect((await request('PATCH', id, '', { id: `${id}-new` })).statusCode).toBe(409);
    expect((await request('DELETE', id, '/capabilities')).statusCode).toBe(409);
    expect((await request('PUT', id, '/capabilities', {})).statusCode).toBe(409);
    await request('POST', id, '/drain');
    expect((await request('PUT', id, '/capabilities', {})).statusCode).toBe(200);
  });
  it('capability read failure rejects guarded mutation even when drained', async () => {
    const id = 'cap-redis-failure';
    await capabilityWorker(id);
    await request('POST', id, '/drain');
    const original = app.redis.get.bind(app.redis);
    const spy = vi
      .spyOn(app.redis, 'get')
      .mockImplementation((...args: Parameters<typeof original>) => {
        if (args[0] === `worker:capabilities:${id}`)
          return Promise.reject(new Error('fixture read failure'));
        return original(...args);
      });
    try {
      expect((await request('DELETE', id, '/capabilities')).statusCode).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
  it('worker deletion clears capability key without drain, while BUSY deletion stays rejected', async () => {
    const id = 'cap-delete-worker';
    await capabilityWorker(id);
    await request('PUT', id, '/queue-gate', { enabled: true });
    await request('PUT', id, '/capabilities', capabilities);
    const raw = await app.redis.hget(REGISTRY_KEY, id);
    if (!raw) throw new Error('missing fixture');
    await app.redis.hset(REGISTRY_KEY, id, JSON.stringify({ ...JSON.parse(raw), status: 'BUSY' }));
    expect((await request('DELETE', id, '')).statusCode).toBe(409);
    await app.redis.hset(REGISTRY_KEY, id, raw);
    expect((await request('DELETE', id, '')).statusCode).toBe(204);
    expect(await app.redis.get(`worker:capabilities:${id}`)).toBeNull();
  });
  it('lists an admin gate-drift warning with budgets unset', async () => {
    const id = 'cap-drift';
    await capabilityWorker(id);
    await app.redis.set(`worker:capabilities:${id}`, JSON.stringify(capabilities));
    await app.redis.del('config:comfy-timeout');
    const response = await app.inject({
      method: 'GET',
      url: '/admin/workers',
      headers: authHeader,
    });
    const worker = response.json().find((w: { id: string }) => w.id === id);
    expect(worker.capabilityWarning).toContain('queue gate');
  });
});
