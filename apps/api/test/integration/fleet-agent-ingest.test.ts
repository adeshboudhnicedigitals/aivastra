import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Redis outlives the per-run test database, so every worker id is unique to this run.
const RUN = randomUUID().slice(0, 8);
const BOOT = '3f1c2b4a-0000-4000-8000-000000000001';

describe('fleet agent: keys, ingest and read views', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let adminAuth: Record<string, string>;
  let modAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    adminAuth = await adminAuthHeader(app, 'ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function createWorker(name: string): Promise<string> {
    const id = `fa-${RUN}-${name}`;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: {
        id,
        label: 'agent test',
        url: 'https://fleet-worker.invalid/',
        apiKey: 'k'.repeat(12),
      },
    });
    expect(res.statusCode).toBe(201);
    return id;
  }
  async function createKey(workerId: string, label = 'test') {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/fleet/workers/${workerId}/agent-keys`,
      headers: superAuth,
      payload: { label },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; key: string; keyPrefix: string };
  }
  /** A worker with a live key, the setup almost every test needs. */
  async function agent(name: string) {
    const workerId = await createWorker(name);
    const { key, id: keyId } = await createKey(workerId);
    return { workerId, key, keyId };
  }

  const gpu = (over: Record<string, unknown> = {}) => ({
    index: 0,
    name: 'Example GPU',
    tempC: 70,
    memTempC: null,
    fanPct: null,
    pstate: 'P0',
    smClockMhz: 2400,
    smClockMaxMhz: 2430,
    memClockMhz: 14001,
    powerW: 300,
    powerLimitW: 600,
    utilGpuPct: 90,
    utilMemPct: 50,
    vramUsedMib: 48000,
    vramTotalMib: 97887,
    throttleReasons: null,
    eccUncorrected: null,
    ...over,
  });
  const sample = (workerId: string, over: Record<string, unknown> = {}) => ({
    v: 1,
    workerId,
    agentVersion: '0.1.0',
    bootId: BOOT,
    seq: 1,
    observedAt: Date.now(),
    gpus: [gpu()],
    computeApps: [{ gpuIndex: 0, name: 'python', vramMib: 40000 }],
    host: {
      cpuCount: 16,
      load1: 1.5,
      load5: 1.2,
      load15: 1,
      ramTotalMib: 84480,
      ramAvailMib: 6000,
      swapTotalMib: 8192,
      swapUsedMib: 100,
      memPsiSome10: null,
      uptimeSec: 1000,
      ntpSynced: true,
      disks: [{ mount: '/', totalGb: 960, usedGb: 700, inodeUsedPct: 10 }],
    },
    services: [{ name: 'comfyui', active: 'active', sub: 'running', restarts: 0 }],
    comfy: [{ instance: 'main', reachable: true, running: 1, pending: 0 }],
    ...over,
  });
  const ingest = (key: string | null, body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/v1/fleet/agent/ingest',
      headers: key === null ? {} : { authorization: `Bearer ${key}` },
      payload: body as Record<string, unknown>,
    });
  const hostRows = (workerId: string) =>
    app.db
      .select()
      .from(schema.fleetHostSamples)
      .where(eq(schema.fleetHostSamples.workerId, workerId));
  const gpuRows = (workerId: string) =>
    app.db
      .select()
      .from(schema.fleetGpuSamples)
      .where(eq(schema.fleetGpuSamples.workerId, workerId));
  const audits = async (workerId: string, action: string) =>
    (
      await app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, workerId))
    ).filter((a) => a.action === action);

  describe('key management', () => {
    it('creates a key once, shows it once, and never stores or audits the plaintext', async () => {
      const workerId = await createWorker('keys-once');
      const { key, keyPrefix, id } = await createKey(workerId, 'first');
      expect(key).toMatch(/^fa_[A-Za-z0-9_-]{43}$/);
      expect(key.startsWith(keyPrefix)).toBe(true);

      const status = await app.inject({
        method: 'GET',
        url: `/admin/fleet/workers/${workerId}/agent`,
        headers: superAuth,
      });
      expect(status.statusCode).toBe(200);
      expect(status.body).not.toContain(key);
      expect(status.json().keys).toEqual([
        expect.objectContaining({
          id,
          label: 'first',
          keyPrefix,
          revokedAt: null,
          lastSeenAt: null,
        }),
      ]);

      const [row] = await app.db
        .select()
        .from(schema.fleetAgents)
        .where(eq(schema.fleetAgents.id, id));
      expect(row?.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.keyHash).not.toBe(key);

      const [audit] = await audits(workerId, 'fleet.agent_key.create');
      expect(audit?.after).toEqual({ keyId: id, keyPrefix, label: 'first' });
      expect(JSON.stringify(audit)).not.toContain(key);
      expect(JSON.stringify(audit)).not.toContain(row?.keyHash);
    });

    it('is SUPER_ADMIN only to create or revoke, and fleet.view to read', async () => {
      const workerId = await createWorker('keys-perms');
      const create = (headers: Record<string, string>) =>
        app.inject({
          method: 'POST',
          url: `/admin/fleet/workers/${workerId}/agent-keys`,
          headers,
          payload: {},
        });
      expect((await create(adminAuth)).statusCode).toBe(403);
      expect((await create(modAuth)).statusCode).toBe(403);
      expect((await create({})).statusCode).toBe(401);

      const { id } = await createKey(workerId);
      const revoke = (headers: Record<string, string>) =>
        app.inject({ method: 'DELETE', url: `/admin/fleet/agent-keys/${id}`, headers });
      expect((await revoke(adminAuth)).statusCode).toBe(403);

      const read = (headers: Record<string, string>) =>
        app.inject({ method: 'GET', url: `/admin/fleet/workers/${workerId}/agent`, headers });
      expect((await read(adminAuth)).statusCode).toBe(200);
      expect((await read(modAuth)).statusCode).toBe(403);
    });

    it('limits active keys per worker and frees a slot on revoke', async () => {
      const workerId = await createWorker('keys-limit');
      const first = await createKey(workerId);
      await createKey(workerId);
      await createKey(workerId);
      const fourth = await app.inject({
        method: 'POST',
        url: `/admin/fleet/workers/${workerId}/agent-keys`,
        headers: superAuth,
        payload: {},
      });
      expect(fourth.statusCode).toBe(409);
      expect(fourth.json().error.code).toBe('TOO_MANY_KEYS');

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/admin/fleet/agent-keys/${first.id}`,
            headers: superAuth,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/admin/fleet/workers/${workerId}/agent-keys`,
            headers: superAuth,
            payload: {},
          })
        ).statusCode,
      ).toBe(201);
    });

    it('revokes with an audit row, is idempotent, and 404s for unknown keys and workers', async () => {
      const workerId = await createWorker('keys-revoke');
      const { id, keyPrefix } = await createKey(workerId, 'to-revoke');
      const del = () =>
        app.inject({ method: 'DELETE', url: `/admin/fleet/agent-keys/${id}`, headers: superAuth });
      expect((await del()).json()).toEqual({ ok: true, changed: true });
      expect((await del()).json()).toEqual({ ok: true, changed: false });
      const rows = await audits(workerId, 'fleet.agent_key.revoke');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.before).toEqual({ keyId: id, keyPrefix, label: 'to-revoke' });

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/admin/fleet/agent-keys/${randomUUID()}`,
            headers: superAuth,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/fleet/workers/fa-nope/agent-keys',
            headers: superAuth,
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('ingest: authentication', () => {
    it('answers every credential failure with the same 401', async () => {
      const { workerId, key, keyId } = await agent('auth-401');
      await app.inject({
        method: 'DELETE',
        url: `/admin/fleet/agent-keys/${keyId}`,
        headers: superAuth,
      });
      const wellFormedUnknown = `fa_${'A'.repeat(43)}`;
      const results = await Promise.all([
        ingest(null, sample(workerId)),
        ingest('not-a-key', sample(workerId)),
        ingest(wellFormedUnknown, sample(workerId)),
        ingest(key, sample(workerId)), // valid shape, now revoked
      ]);
      for (const r of results) {
        expect(r.statusCode).toBe(401);
        expect(r.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'invalid agent key' } });
      }
    });

    it('authenticates before validating, so a bad body from a stranger reveals nothing', async () => {
      const res = await ingest(`fa_${'B'.repeat(43)}`, { nonsense: true });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain('Required');
    });

    it('refuses a key that speaks for a different worker', async () => {
      const a = await agent('mismatch-a');
      const b = await createWorker('mismatch-b');
      const res = await ingest(a.key, sample(b));
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('WORKER_MISMATCH');
      expect(await hostRows(b)).toHaveLength(0);
    });
  });

  describe('ingest: accepting samples', () => {
    it('stores a sample, its GPU rows, the live view and the heartbeat', async () => {
      const { workerId, key } = await agent('ok');
      const obs = Date.now();
      const res = await ingest(key, sample(workerId, { observedAt: obs }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, duplicate: false, commandsPending: 0 });
      expect(Math.abs(res.json().serverTime - Date.now())).toBeLessThan(5000);

      const [host] = await hostRows(workerId);
      expect(host).toMatchObject({
        workerId,
        bootId: BOOT,
        seq: 1,
        agentVersion: '0.1.0',
        ramAvailMib: 6000,
        swapUsedMib: 100,
        ntpSynced: true,
      });
      expect(host?.observedAt.getTime()).toBe(obs);
      expect(host?.disks).toEqual([{ mount: '/', totalGb: 960, usedGb: 700, inodeUsedPct: 10 }]);
      const [g] = await gpuRows(workerId);
      expect(g).toMatchObject({ gpuIndex: 0, tempC: 70, smClockMhz: 2400, vramUsedMib: 48000 });
      expect(g?.memTempC).toBeNull(); // unknown stays NULL, never 0

      const status = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/agent`,
          headers: superAuth,
        })
      ).json();
      expect(status.heartbeat).toMatchObject({ agentVersion: '0.1.0', bootId: BOOT });
      expect(status.rejectsLastHour).toBe(0);
    });

    it('treats a replay as a no-op and says so', async () => {
      const { workerId, key } = await agent('replay');
      const body = sample(workerId, { seq: 7 });
      expect((await ingest(key, body)).json().duplicate).toBe(false);
      const again = await ingest(key, body);
      expect(again.statusCode).toBe(200);
      expect(again.json().duplicate).toBe(true);
      expect(await hostRows(workerId)).toHaveLength(1);
      expect(await gpuRows(workerId)).toHaveLength(1);
    });

    it('accepts a sample with no GPUs (a box whose nvidia-smi is unusable)', async () => {
      const { workerId, key } = await agent('nogpu');
      const res = await ingest(key, sample(workerId, { gpus: [], computeApps: [] }));
      expect(res.statusCode).toBe(200);
      expect(await hostRows(workerId)).toHaveLength(1);
      expect(await gpuRows(workerId)).toHaveLength(0);
    });

    it('stores several GPUs from one sample', async () => {
      const { workerId, key } = await agent('multigpu');
      await ingest(
        key,
        sample(workerId, { gpus: [gpu({ index: 0 }), gpu({ index: 1, tempC: 80 })] }),
      );
      const rows = await gpuRows(workerId);
      expect(rows.map((r) => [r.gpuIndex, r.tempC]).sort()).toEqual([
        [0, 70],
        [1, 80],
      ]);
    });

    it('never lets an older sample replace a newer live view (spool flush after an outage)', async () => {
      const { workerId, key } = await agent('ordering');
      const now = Date.now();
      await ingest(key, sample(workerId, { seq: 2, observedAt: now, gpus: [gpu({ tempC: 81 })] }));
      await ingest(
        key,
        sample(workerId, { seq: 1, observedAt: now - 30_000, gpus: [gpu({ tempC: 55 })] }),
      );
      const view = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/telemetry`,
          headers: superAuth,
        })
      ).json();
      expect(view.telemetry.seq).toBe(2);
      expect(view.telemetry.gpus[0].tempC).toBe(81);
      // Both are still kept as history.
      expect(await hostRows(workerId)).toHaveLength(2);
    });
  });

  describe('ingest: refusing samples', () => {
    it('rejects an invalid payload with 400 and counts it against the worker', async () => {
      const { workerId, key } = await agent('invalid');
      const bad = await ingest(key, sample(workerId, { gpus: [gpu({ tempC: 9999 })] }));
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION');
      const unknownField = await ingest(key, { ...sample(workerId), hostname: 'box' });
      expect(unknownField.statusCode).toBe(400);
      expect(await hostRows(workerId)).toHaveLength(0);

      const status = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/agent`,
          headers: superAuth,
        })
      ).json();
      expect(status.rejectsLastHour).toBe(2);
      expect(status.heartbeat).toBeNull(); // trying and failing is not "alive"
    });

    it.each([
      ['far in the past', -11 * 60_000],
      ['in the future', 3 * 60_000],
    ])('rejects a sample time that is %s and tells the agent the server time', async (_l, delta) => {
      const { workerId, key } = await agent(`clock${delta}`);
      const res = await ingest(key, sample(workerId, { observedAt: Date.now() + delta }));
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'CLOCK_SKEW' });
      expect(Math.abs(res.json().error.serverTime - Date.now())).toBeLessThan(5000);
      expect(await hostRows(workerId)).toHaveLength(0);
    });

    it('rejects a body over the size limit', async () => {
      const { workerId, key } = await agent('oversize');
      const res = await ingest(key, sample(workerId, { agentVersion: 'x'.repeat(40_000) }));
      expect(res.statusCode).toBe(413);
      expect(await hostRows(workerId)).toHaveLength(0);
    });

    it('answers 503 when history cannot be stored, but still records the heartbeat', async () => {
      const { workerId, key } = await agent('pgdown');
      const spy = vi.spyOn(app.db, 'transaction').mockRejectedValueOnce(new Error('pg down'));
      const res = await ingest(key, sample(workerId));
      spy.mockRestore();
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('INGEST_UNAVAILABLE');
      expect(await hostRows(workerId)).toHaveLength(0);
      // The live view and heartbeat survive, and the agent retries from its spool.
      const status = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/agent`,
          headers: superAuth,
        })
      ).json();
      expect(status.heartbeat).not.toBeNull();
      // The same sample, retried, now stores.
      expect((await ingest(key, sample(workerId))).json().duplicate).toBe(false);
    });

    it('rate limits per key, not per address', async () => {
      const a = await agent('rl-a');
      const b = await agent('rl-b');
      const send = (k: string, w: string, seq: number) =>
        ingest(k, sample(w, { seq, observedAt: Date.now() }));
      const codes: number[] = [];
      for (let i = 0; i < 31; i++) codes.push((await send(a.key, a.workerId, i)).statusCode);
      expect(codes.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(codes[30]).toBe(429);
      // Another box on the same address is unaffected.
      expect((await send(b.key, b.workerId, 0)).statusCode).toBe(200);
    }, 60000);
  });

  describe('bookkeeping and read views', () => {
    it('updates last_seen on the key, and not more than once a minute', async () => {
      const { workerId, key, keyId } = await agent('lastseen');
      await ingest(key, sample(workerId, { seq: 1, agentVersion: '0.1.0' }));
      const [first] = await app.db
        .select()
        .from(schema.fleetAgents)
        .where(eq(schema.fleetAgents.id, keyId));
      expect(first?.lastSeenAt).not.toBeNull();
      expect(first?.agentVersion).toBe('0.1.0');
      expect(first?.bootId).toBe(BOOT);

      await ingest(key, sample(workerId, { seq: 2, agentVersion: '0.2.0' }));
      const [second] = await app.db
        .select()
        .from(schema.fleetAgents)
        .where(eq(schema.fleetAgents.id, keyId));
      expect(second?.lastSeenAt?.getTime()).toBe(first?.lastSeenAt?.getTime());
      expect(second?.agentVersion).toBe('0.1.0'); // throttled write, so the newer version waits
    });

    it('reports no telemetry, not an empty sample, for a worker that never reported', async () => {
      const workerId = await createWorker('silent');
      const view = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/telemetry`,
          headers: superAuth,
        })
      ).json();
      expect(view).toMatchObject({ telemetry: null, receivedAt: null, stale: true, signals: [] });
    });

    it('serves the latest sample with derived signals, marks an old one stale, and keeps unknowns null', async () => {
      const { workerId, key } = await agent('view');
      await ingest(
        key,
        sample(workerId, {
          observedAt: Date.now() - 50_000, // accepted, but older than the stale threshold
          gpus: [gpu({ tempC: 86, smClockMhz: 899, smClockMaxMhz: 2430, memTempC: null })],
        }),
      );
      const view = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/telemetry`,
          headers: superAuth,
        })
      ).json();
      expect(view.stale).toBe(true);
      expect(view.clockSkewMs).toBeGreaterThanOrEqual(50_000);
      expect(view.telemetry.gpus[0].memTempC).toBeNull();
      expect(view.signals).toEqual([
        { index: 0, clockRatio: 0.37, thermalCollapseNow: true, foreignVramMib: 8000 },
      ]);

      // A fresh sample is not stale.
      await ingest(key, sample(workerId, { seq: 2 }));
      const fresh = (
        await app.inject({
          method: 'GET',
          url: `/admin/fleet/workers/${workerId}/telemetry`,
          headers: superAuth,
        })
      ).json();
      expect(fresh.stale).toBe(false);
      expect(fresh.signals[0].thermalCollapseNow).toBe(false);
    });

    it('requires fleet.view and a registered worker for the read views', async () => {
      const workerId = await createWorker('view-perms');
      const get = (url: string, headers: Record<string, string>) =>
        app.inject({ method: 'GET', url, headers });
      const t = `/admin/fleet/workers/${workerId}/telemetry`;
      expect((await get(t, adminAuth)).statusCode).toBe(200);
      expect((await get(t, modAuth)).statusCode).toBe(403);
      expect((await get(t, {})).statusCode).toBe(401);
      expect((await get('/admin/fleet/workers/fa-nope/telemetry', superAuth)).statusCode).toBe(404);
      expect((await get('/admin/fleet/workers/fa-nope/agent', superAuth)).statusCode).toBe(404);
    });

    it("stops accepting a worker's samples the moment its key is revoked", async () => {
      const { workerId, key, keyId } = await agent('revoke-live');
      expect((await ingest(key, sample(workerId, { seq: 1 }))).statusCode).toBe(200);
      await app.inject({
        method: 'DELETE',
        url: `/admin/fleet/agent-keys/${keyId}`,
        headers: superAuth,
      });
      expect((await ingest(key, sample(workerId, { seq: 2 }))).statusCode).toBe(401);
      expect(await hostRows(workerId)).toHaveLength(1);
    });
  });
});
