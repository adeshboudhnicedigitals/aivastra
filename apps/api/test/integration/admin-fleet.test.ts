import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const API_KEY = 'fleet-secret-key-0123456789';
const WORKER_URL = 'https://fleet-worker.invalid/';

describe('GET /admin/fleet', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let adminAuth: Record<string, string>;
  let modAuth: Record<string, string>;
  let supportAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    adminAuth = await adminAuthHeader(app, 'ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');
    supportAuth = await adminAuthHeader(app, 'SUPPORT');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function createWorker(id: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: { id, label: 'Fleet test', url: WORKER_URL, apiKey: API_KEY },
    });
    expect(res.statusCode).toBe(201);
  }

  async function fleet(headers?: Record<string, string>) {
    return app.inject({ method: 'GET', url: '/admin/fleet', headers });
  }

  it('requires fleet.view: SUPER_ADMIN and ADMIN allowed, MODERATOR and SUPPORT forbidden', async () => {
    expect((await fleet(superAuth)).statusCode).toBe(200);
    expect((await fleet(adminAuth)).statusCode).toBe(200);
    expect((await fleet(modAuth)).statusCode).toBe(403);
    expect((await fleet(supportAuth)).statusCode).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    expect((await fleet()).statusCode).toBe(401);
  });

  it('never returns the worker URL or API key', async () => {
    await createWorker('fleet-test-leak');
    const res = await fleet(superAuth);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(API_KEY);
    expect(res.body).not.toContain('fleet-worker.invalid');
    expect(res.body).not.toContain('apiKey');
  });

  it('reports a registered worker without inventing observations', async () => {
    const id = 'fleet-test-registered';
    await createWorker(id);
    const body = (await fleet(superAuth)).json();
    expect(body.source).toBe('LIVE');
    const w = body.workers.find((x: { workerId: string }) => x.workerId === id);
    expect(w).toMatchObject({
      workerId: id,
      label: 'Fleet test',
      dispatcherState: 'IDLE',
      inRegistry: true,
      ownership: 'UNKNOWN',
    });
    // No queue sample yet: not observed, not "observed idle".
    expect(w.comfy).toMatchObject({
      reachable: null,
      running: null,
      pending: null,
      observedAt: null,
      stale: true,
    });
  });

  describe('system sample (VRAM and host RAM)', () => {
    const GIB = 1024 ** 3;
    const sample = (observedAt: number, over: Record<string, unknown> = {}) =>
      JSON.stringify({
        observedAt,
        gpuName: 'Example GPU',
        vramTotalBytes: 96 * GIB,
        vramFreeBytes: 56 * GIB,
        ramTotalBytes: 80 * GIB,
        ramFreeBytes: 60 * GIB,
        ...over,
      });
    const find = async (id: string) =>
      (await fleet(superAuth)).json().workers.find((x: { workerId: string }) => x.workerId === id);

    it('reports no GPU or memory figures when nothing was observed', async () => {
      const id = 'fleet-test-sys-none';
      await createWorker(id);
      const w = await find(id);
      expect(w.gpu).toEqual({
        name: null,
        vramUsedMb: null,
        vramTotalMb: null,
        observedAt: null,
        stale: true,
      });
      expect(w.hostMemory).toEqual({
        totalGb: null,
        availableGb: null,
        observedAt: null,
        stale: true,
      });
    });

    it('converts a fresh sample to MiB / GiB and derives VRAM used', async () => {
      const id = 'fleet-test-sys-fresh';
      await createWorker(id);
      await app.redis.set(`worker:system:${id}`, sample(Date.now()));
      const w = await find(id);
      expect(w.gpu).toMatchObject({
        name: 'Example GPU',
        vramTotalMb: 96 * 1024,
        vramUsedMb: 40 * 1024,
        stale: false,
      });
      expect(w.hostMemory).toMatchObject({ totalGb: 80, availableGb: 60, stale: false });
    });

    it('marks an old sample stale but still dated', async () => {
      const id = 'fleet-test-sys-old';
      await createWorker(id);
      await app.redis.set(`worker:system:${id}`, sample(Date.now() - 5 * 60_000));
      const w = await find(id);
      expect(w.gpu.stale).toBe(true);
      expect(w.gpu.observedAt).not.toBeNull();
    });

    it('does not turn an impossible free > total into a negative used figure', async () => {
      const id = 'fleet-test-sys-bad';
      await createWorker(id);
      await app.redis.set(`worker:system:${id}`, sample(Date.now(), { vramFreeBytes: 200 * GIB }));
      const w = await find(id);
      expect(w.gpu.vramUsedMb).toBeNull();
      expect(w.gpu.vramTotalMb).toBe(96 * 1024);
    });

    it('treats a malformed or over-wide sample as not observed and never echoes extras', async () => {
      const id = 'fleet-test-sys-junk';
      await createWorker(id);
      await app.redis.set(`worker:system:${id}`, '{"observedAt":"yesterday"}');
      expect((await find(id)).gpu.observedAt).toBeNull();

      await app.redis.set(
        `worker:system:${id}`,
        sample(Date.now(), { argv: ['--secret-flag'], torchVramTotal: 1 }),
      );
      const res = await fleet(superAuth);
      expect(res.body).not.toContain('secret-flag');
      expect(res.body).not.toContain('argv');
    });
  });

  describe('stream backlog', () => {
    const GROUP = 'dispatcher-cg';
    const queues = async () =>
      (await fleet(superAuth)).json().queues as {
        stream: string;
        waiting: number | null;
        inFlight: number | null;
        capped: boolean;
      }[];
    const of = async (stream: string) => (await queues()).find((q) => q.stream === stream);

    it('lists the four dispatcher lanes', async () => {
      expect((await queues()).map((q) => q.stream)).toEqual([
        'jobs:priority',
        'jobs:normal',
        'jobs:low',
        'jobs:video',
      ]);
    });

    it('counts undelivered entries as waiting and unacknowledged ones as in flight', async () => {
      await app.redis.del('jobs:low');
      await app.redis.xgroup('CREATE', 'jobs:low', GROUP, '$', 'MKSTREAM');
      for (let i = 0; i < 3; i++) await app.redis.xadd('jobs:low', '*', 'jobId', `j${i}`);
      expect(await of('jobs:low')).toMatchObject({ waiting: 3, inFlight: 0, capped: false });

      const read = (await app.redis.xreadgroup(
        'GROUP',
        GROUP,
        'test-consumer',
        'COUNT',
        1,
        'STREAMS',
        'jobs:low',
        '>',
      )) as [string, [string, string[]][]][];
      expect(await of('jobs:low')).toMatchObject({ waiting: 2, inFlight: 1 });

      await app.redis.xack('jobs:low', GROUP, read[0]?.[1][0]?.[0] ?? '');
      // Acked entries stay in the stream (XLEN still 3) but are no longer work.
      expect(await of('jobs:low')).toMatchObject({ waiting: 2, inFlight: 0 });
      expect(await app.redis.xlen('jobs:low')).toBe(3);
    });

    it('treats a stream nobody has written to as empty, not unknown', async () => {
      await app.redis.del('jobs:video');
      expect(await of('jobs:video')).toEqual({
        stream: 'jobs:video',
        waiting: 0,
        inFlight: 0,
        capped: false,
      });
    });

    it('reports unknown when entries exist but the dispatcher group does not', async () => {
      await app.redis.del('jobs:priority');
      await app.redis.xadd('jobs:priority', '*', 'jobId', 'x');
      expect(await of('jobs:priority')).toMatchObject({ waiting: null, inFlight: null });
      await app.redis.del('jobs:priority');
    });
  });

  describe('ownership', () => {
    let userId: string;
    beforeAll(async () => {
      const [u] = await app.db.select({ id: schema.users.id }).from(schema.users).limit(1);
      if (!u) throw new Error('no user for job fixtures');
      userId = u.id;
    });

    async function dispatched(workerId: string, promptId: string) {
      const [job] = await app.db
        .insert(schema.jobs)
        .values({ userId, status: 'PROCESSING', source: JOB_SOURCE.API_TRYON, creditsCharged: 1 })
        .returning();
      if (!job) throw new Error('job insert failed');
      await app.db.insert(schema.jobEvents).values({
        jobId: job.id,
        eventType: 'COMFY_DISPATCH',
        payload: { promptId, workerId },
      });
      return job.id;
    }
    const queue = (over: Record<string, unknown>) =>
      JSON.stringify({
        queueRemaining: 0,
        running: 0,
        pending: 0,
        probedAt: Date.now(),
        runningPromptIds: [],
        pendingPromptIds: [],
        ...over,
      });
    const find = async (id: string) =>
      (await fleet(superAuth)).json().workers.find((x: { workerId: string }) => x.workerId === id);

    it('is NONE for an empty queue', async () => {
      const id = 'fleet-own-none';
      await createWorker(id);
      await app.redis.set(`worker:queue:${id}`, queue({}));
      const w = await find(id);
      expect(w.ownership).toBe('NONE');
      expect(w.prompt).toBeNull();
    });

    it('is PRODUCTION and names the job when the running prompt was dispatched to this worker', async () => {
      const id = 'fleet-own-prod';
      await createWorker(id);
      const jobId = await dispatched(id, 'prompt-prod-1');
      await app.redis.set(
        `worker:queue:${id}`,
        queue({ queueRemaining: 1, running: 1, runningPromptIds: ['prompt-prod-1'] }),
      );
      const w = await find(id);
      expect(w.ownership).toBe('PRODUCTION');
      expect(w.prompt).toMatchObject({ id: 'prompt-prod-1', jobId });
    });

    it('is UNATTRIBUTED, not FOREIGN, for a prompt with no dispatch record', async () => {
      const id = 'fleet-own-unattr';
      await createWorker(id);
      await app.redis.set(
        `worker:queue:${id}`,
        queue({ queueRemaining: 1, running: 1, runningPromptIds: ['prompt-nobody'] }),
      );
      const w = await find(id);
      expect(w.ownership).toBe('UNATTRIBUTED');
      expect(w.prompt).toMatchObject({ id: 'prompt-nobody', jobId: null });
    });

    it('does not credit a prompt that was dispatched to a different worker', async () => {
      const id = 'fleet-own-other';
      await createWorker(id);
      await dispatched('some-other-worker', 'prompt-elsewhere');
      await app.redis.set(
        `worker:queue:${id}`,
        queue({ queueRemaining: 1, running: 1, runningPromptIds: ['prompt-elsewhere'] }),
      );
      expect((await find(id)).ownership).toBe('UNATTRIBUTED');
    });

    it('is UNATTRIBUTED when any queued prompt is unmatched, even if the running one is ours', async () => {
      const id = 'fleet-own-mixed';
      await createWorker(id);
      await dispatched(id, 'prompt-mixed-ours');
      await app.redis.set(
        `worker:queue:${id}`,
        queue({
          queueRemaining: 2,
          running: 1,
          pending: 1,
          runningPromptIds: ['prompt-mixed-ours'],
          pendingPromptIds: ['prompt-mixed-theirs'],
        }),
      );
      expect((await find(id)).ownership).toBe('UNATTRIBUTED');
    });

    it('is UNKNOWN when the prompt id list is shorter than the queue counts', async () => {
      const id = 'fleet-own-short';
      await createWorker(id);
      await app.redis.set(
        `worker:queue:${id}`,
        queue({
          queueRemaining: 3,
          running: 1,
          pending: 2,
          runningPromptIds: ['a'],
          pendingPromptIds: ['b'],
        }),
      );
      const w = await find(id);
      expect(w.ownership).toBe('UNKNOWN');
      expect(w.prompt).toBeNull();
    });

    it('is UNKNOWN for a stale queue sample and for a probe error', async () => {
      const stale = 'fleet-own-stale';
      await createWorker(stale);
      await app.redis.set(`worker:queue:${stale}`, queue({ probedAt: Date.now() - 5 * 60_000 }));
      expect((await find(stale)).ownership).toBe('UNKNOWN');

      const err = 'fleet-own-error';
      await createWorker(err);
      await app.redis.set(
        `worker:queue:${err}`,
        JSON.stringify({
          queueRemaining: null,
          running: null,
          pending: null,
          probedAt: Date.now(),
          error: 'HTTP 502',
        }),
      );
      expect((await find(err)).ownership).toBe('UNKNOWN');
    });
  });

  it('shows a fresh queue sample as current and an old one as stale', async () => {
    const id = 'fleet-test-queue';
    await createWorker(id);
    const sample = (probedAt: number) =>
      JSON.stringify({ queueRemaining: 3, running: 1, pending: 2, probedAt });

    await app.redis.set(`worker:queue:${id}`, sample(Date.now()));
    let w = (await fleet(superAuth))
      .json()
      .workers.find((x: { workerId: string }) => x.workerId === id);
    expect(w.comfy).toMatchObject({ reachable: true, running: 1, pending: 2, stale: false });

    await app.redis.set(`worker:queue:${id}`, sample(Date.now() - 5 * 60_000));
    w = (await fleet(superAuth))
      .json()
      .workers.find((x: { workerId: string }) => x.workerId === id);
    expect(w.comfy.stale).toBe(true);
  });

  it('reports a probe error as unreachable ComfyUI, not as an empty queue', async () => {
    const id = 'fleet-test-probe-error';
    await createWorker(id);
    await app.redis.set(
      `worker:queue:${id}`,
      JSON.stringify({
        queueRemaining: null,
        running: null,
        pending: null,
        probedAt: Date.now(),
        error: 'HTTP 502',
      }),
    );
    const w = (await fleet(superAuth))
      .json()
      .workers.find((x: { workerId: string }) => x.workerId === id);
    expect(w.comfy).toMatchObject({ reachable: false, running: null, pending: null });
  });

  it('marks a worker row absent from the registry as UNKNOWN rather than guessing IDLE', async () => {
    const id = 'fleet-test-unregistered';
    await app.db.insert(schema.workers).values({
      id,
      label: 'Not in registry',
      url: WORKER_URL,
      apiKey: API_KEY,
      isActive: true,
      allowedJobTypes: [],
    });
    await app.redis.hdel('worker:registry', id);
    const w = (await fleet(superAuth))
      .json()
      .workers.find((x: { workerId: string }) => x.workerId === id);
    expect(w).toMatchObject({ inRegistry: false, dispatcherState: 'UNKNOWN', health: 'UNKNOWN' });
  });
});
