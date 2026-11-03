import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  fleetAgentHeartbeatKey,
  fleetAgentLatestKey,
  fleetAgentSummariesSchema,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const RUN = randomUUID().slice(0, 8);

describe('GET /admin/fleet/agents', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let modAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function monitored(name: string) {
    const id = `ov-${RUN}-${name}`;
    await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: {
        id,
        label: 'overview',
        url: 'https://fleet-worker.invalid/',
        apiKey: 'k'.repeat(12),
      },
    });
    // Agent keys belong to a box; register one linked to this worker, as enrolment would.
    await app.db
      .insert(schema.fleetHosts)
      .values({ id, label: id, workerId: id })
      .onConflictDoNothing();
    const k = await app.inject({
      method: 'POST',
      url: `/admin/fleet/workers/${id}/agent-keys`,
      headers: superAuth,
      payload: {},
    });
    return { id, keyId: (k.json() as { id: string }).id };
  }
  const gpu = (over: Record<string, unknown> = {}) => ({
    index: 0,
    name: 'GPU',
    tempC: 60,
    memTempC: null,
    fanPct: null,
    pstate: 'P2',
    smClockMhz: 1200,
    smClockMaxMhz: 2400,
    memClockMhz: null,
    powerW: 100,
    powerLimitW: 400,
    utilGpuPct: 40,
    utilMemPct: 10,
    vramUsedMib: 1000,
    vramTotalMib: 24000,
    throttleReasons: null,
    eccUncorrected: null,
    ...over,
  });
  async function report(id: string, gpus: unknown[], hostOver: Record<string, unknown> = {}) {
    const now = Date.now();
    await app.redis.set(
      fleetAgentHeartbeatKey(id),
      JSON.stringify({ receivedAt: now, observedAt: now }),
      'EX',
      300,
    );
    await app.redis.set(
      fleetAgentLatestKey(id),
      JSON.stringify({
        v: 1,
        workerId: id,
        agentVersion: '0.1.0',
        bootId: 'boot-0001',
        seq: 1,
        observedAt: now - 1000,
        receivedAt: now,
        clockSkewMs: 50,
        gpus,
        computeApps: [],
        host: {
          cpuCount: 8,
          load1: 1,
          load5: 1,
          load15: 1,
          ramTotalMib: 64000,
          ramAvailMib: 30000,
          swapTotalMib: 0,
          swapUsedMib: 0,
          memPsiSome10: 0,
          uptimeSec: 100,
          ntpSynced: true,
          disks: [{ mount: '/', totalGb: 100, usedGb: 95, inodeUsedPct: 2 }],
          ...hostOver,
        },
        services: [],
        comfy: [{ instance: 'main', reachable: true, running: 1, pending: 2 }],
      }),
      'EX',
      300,
    );
  }
  const get = async (headers = superAuth) =>
    app.inject({ method: 'GET', url: '/admin/fleet/agents', headers });
  const find = async (id: string) =>
    fleetAgentSummariesSchema.parse((await get()).json()).workers.find((w) => w.workerId === id);

  it('lists a monitored worker with no data as null telemetry, not zeros', async () => {
    const { id } = await monitored('nodata');
    expect(await find(id)).toEqual({
      workerId: id,
      heartbeatAt: null,
      telemetry: null,
      incidents: { critical: 0, warning: 0, info: 0 },
    });
  });

  it('summarises the worst GPU and totals, and passes comfy through', async () => {
    const { id } = await monitored('two');
    await report(id, [gpu({ index: 0, tempC: 70 }), gpu({ index: 1, tempC: 85, smClockMhz: 600 })]);
    const w = await find(id);
    expect(w?.heartbeatAt).not.toBeNull();
    expect(w?.telemetry).toMatchObject({
      stale: false,
      gpuCount: 2,
      tempMaxC: 85,
      clockRatioMin: 0.25,
      powerWTotal: 200,
      vramUsedMib: 2000,
      vramTotalMib: 48000,
      diskUsedPctMax: 95,
      comfy: { reachable: true, running: 1, pending: 2 },
    });
  });

  it('is null (unknown) when any GPU input is unknown, never a partial sum', async () => {
    const { id } = await monitored('partial');
    await report(id, [gpu({ index: 0 }), gpu({ index: 1, powerW: null, tempC: null })]);
    const t = (await find(id))?.telemetry;
    expect(t?.powerWTotal).toBeNull();
    expect(t?.tempMaxC).toBeNull();
    expect(t?.vramUsedMib).toBe(2000);
  });

  it('counts live incidents by severity and ignores recovered ones', async () => {
    const { id } = await monitored('inc');
    const row = (state: string, severity: string, ruleKey: string) =>
      app.db
        .insert(schema.fleetIncidents)
        .values({ ruleKey, workerId: id, state, severity, summary: 's', evidence: {} });
    await row('OPEN', 'critical', 'agent_silent');
    await row('ACK', 'warning', 'disk_high');
    await row('RECOVERED', 'warning', 'ram_low');
    expect((await find(id))?.incidents).toEqual({ critical: 1, warning: 1, info: 0 });
  });

  it('omits workers whose keys are all revoked', async () => {
    const { id, keyId } = await monitored('revoked');
    expect(await find(id)).toBeDefined();
    await app.db
      .update(schema.fleetAgents)
      .set({ revokedAt: new Date() })
      .where(eq(schema.fleetAgents.id, keyId));
    expect(await find(id)).toBeUndefined();
  });

  it('requires fleet.view', async () => {
    expect((await get(modAuth)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/fleet/agents' })).statusCode).toBe(401);
  });
});
