import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { fleetAgentHeartbeatKey, fleetAgentLatestKey, fleetAgentRejectsKey } from '@aivastra/types';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runFleetEvaluatorTick, thermalSlowedByWorker } from '../../src/modules/fleet/evaluator';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Captures alert emails instead of sending them: the dev .env holds a real Resend key.
const sendFleetAlertEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/lib/mailer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/mailer')>()),
  sendFleetAlertEmail,
}));

// Redis outlives the per-run database, so ids are unique per run.
const RUN = randomUUID().slice(0, 8);
const T0 = Date.now();
const S = 1000;

describe('fleet alert evaluator', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function monitoredWorker(name: string, lastSeenAt: number | null = T0) {
    const id = `ev-${RUN}-${name}`;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: {
        id,
        label: 'evaluator test',
        url: 'https://fleet-worker.invalid/',
        apiKey: 'k'.repeat(12),
      },
    });
    expect(res.statusCode).toBe(201);
    // Agent keys belong to a box; register one linked to this worker, as enrolment would.
    await app.db
      .insert(schema.fleetHosts)
      .values({ id, label: id, workerId: id })
      .onConflictDoNothing();
    const key = await app.inject({
      method: 'POST',
      url: `/admin/fleet/workers/${id}/agent-keys`,
      headers: superAuth,
      payload: { label: 'ev' },
    });
    expect(key.statusCode).toBe(201);
    const keyId = (key.json() as { id: string }).id;
    if (lastSeenAt !== null) {
      await app.db
        .update(schema.fleetAgents)
        .set({ lastSeenAt: new Date(lastSeenAt) })
        .where(eq(schema.fleetAgents.id, keyId));
    }
    return { id, keyId };
  }

  const beat = (id: string) =>
    app.redis.set(fleetAgentHeartbeatKey(id), '{"observedAt":1}', 'EX', 600);
  const noBeat = (id: string) => app.redis.del(fleetAgentHeartbeatKey(id));
  async function latest(id: string, now: number, gpu: Record<string, unknown> = {}) {
    const body = {
      v: 1,
      workerId: id,
      agentVersion: '0.1.0',
      bootId: 'boot-0001',
      seq: 1,
      observedAt: now - 2 * S,
      receivedAt: now,
      clockSkewMs: 100,
      gpus: [
        {
          index: 0,
          name: 'GPU',
          tempC: 60,
          memTempC: null,
          fanPct: null,
          pstate: 'P2',
          smClockMhz: 2400,
          smClockMaxMhz: 2400,
          memClockMhz: null,
          powerW: 100,
          powerLimitW: 400,
          utilGpuPct: 50,
          utilMemPct: 10,
          vramUsedMib: 1000,
          vramTotalMib: 24000,
          throttleReasons: null,
          eccUncorrected: null,
          ...gpu,
        },
      ],
      computeApps: [],
      host: {
        cpuCount: 8,
        load1: 1,
        load5: 1,
        load15: 1,
        ramTotalMib: 64000,
        ramAvailMib: 40000,
        swapTotalMib: 0,
        swapUsedMib: 0,
        memPsiSome10: 0,
        uptimeSec: 1000,
        ntpSynced: true,
        disks: [{ mount: '/', totalGb: 500, usedGb: 100, inodeUsedPct: 5 }],
      },
      services: [],
      comfy: [],
    };
    await app.redis.set(fleetAgentLatestKey(id), JSON.stringify(body), 'EX', 600);
  }

  const incidents = (id: string) =>
    app.db.select().from(schema.fleetIncidents).where(eq(schema.fleetIncidents.workerId, id));
  const events = async (incidentId: string) =>
    (
      await app.db
        .select()
        .from(schema.fleetIncidentEvents)
        .where(eq(schema.fleetIncidentEvents.incidentId, incidentId))
        .orderBy(asc(schema.fleetIncidentEvents.id))
    ).map((e) => e.kind);

  it('opens agent_silent after its window, escalates once, and recovers when the agent returns', async () => {
    const { id } = await monitoredWorker('silent');
    await noBeat(id);

    await runFleetEvaluatorTick(app, { now: T0 + 100 * S }); // starts the pending window
    expect(await incidents(id)).toHaveLength(0);
    await runFleetEvaluatorTick(app, { now: T0 + 189 * S }); // 89 s into the 90 s window
    expect(await incidents(id)).toHaveLength(0);

    const opened = await runFleetEvaluatorTick(app, { now: T0 + 190 * S });
    expect(opened.opened).toBe(1);
    let [inc] = await incidents(id);
    expect(inc).toMatchObject({ ruleKey: 'agent_silent', state: 'OPEN', severity: 'warning' });

    // Ticking again must not duplicate.
    const again = await runFleetEvaluatorTick(app, { now: T0 + 200 * S });
    expect(again.opened).toBe(0);
    expect(await incidents(id)).toHaveLength(1);

    const esc = await runFleetEvaluatorTick(app, { now: T0 + 301 * S });
    expect(esc.escalated).toBe(1);
    expect((await runFleetEvaluatorTick(app, { now: T0 + 320 * S })).escalated).toBe(0);
    [inc] = await incidents(id);
    expect(inc?.severity).toBe('critical');

    await beat(id);
    await runFleetEvaluatorTick(app, { now: T0 + 400 * S });
    expect((await incidents(id))[0]?.state).toBe('OPEN'); // 30 s clear window not yet served
    const rec = await runFleetEvaluatorTick(app, { now: T0 + 430 * S });
    expect(rec.recovered).toBe(1);
    [inc] = await incidents(id);
    expect(inc?.state).toBe('RECOVERED');
    expect(inc?.recoveredAt).not.toBeNull();
    expect(await events(inc?.id ?? '')).toEqual(['OPENED', 'ESCALATED', 'RECOVERED']);
  });

  it('keeps watching a box whose dispatcher worker is disabled', async () => {
    // The reason the dashboard is box-first: disabling a worker in the admin panel must not hide
    // a dead or overheating machine.
    const { id } = await monitoredWorker('worker-off');
    await app.db.update(schema.workers).set({ isActive: false }).where(eq(schema.workers.id, id));
    await noBeat(id);
    await runFleetEvaluatorTick(app, { now: T0 + 100 * S });
    const opened = await runFleetEvaluatorTick(app, { now: T0 + 190 * S });
    expect(opened.opened).toBe(1);
    const [inc] = await incidents(id);
    expect(inc).toMatchObject({ ruleKey: 'agent_silent', state: 'OPEN' });
  });

  it('does not alert for an agent that never connected', async () => {
    const { id } = await monitoredWorker('never', null);
    await noBeat(id);
    await runFleetEvaluatorTick(app, { now: T0 + 1000 * S });
    await runFleetEvaluatorTick(app, { now: T0 + 2000 * S });
    expect(await incidents(id)).toHaveLength(0);
  });

  it('emails warning incidents on open and recovery when recipients are set, and info ones never', async () => {
    const env = app.env as { FLEET_ALERT_EMAILS?: string };
    env.FLEET_ALERT_EMAILS = 'ops@example.com';
    try {
      sendFleetAlertEmail.mockClear();
      const { id } = await monitoredWorker('mail');
      await beat(id);
      await app.redis.set(fleetAgentRejectsKey(id), '12', 'EX', 600);
      await runFleetEvaluatorTick(app, { now: T0 });
      await vi.waitFor(() => expect(sendFleetAlertEmail).toHaveBeenCalledTimes(1));
      expect(sendFleetAlertEmail.mock.calls[0]?.[2]).toEqual(['ops@example.com']);
      expect(sendFleetAlertEmail.mock.calls[0]?.[3]).toMatchObject({
        kind: 'opened',
        severity: 'warning',
        workerId: id,
        ruleKey: 'ingest_rejected',
      });

      await app.redis.del(fleetAgentRejectsKey(id));
      await runFleetEvaluatorTick(app, { now: T0 + 1 * S });
      await runFleetEvaluatorTick(app, { now: T0 + 601 * S });
      await vi.waitFor(() => expect(sendFleetAlertEmail).toHaveBeenCalledTimes(2));
      expect(sendFleetAlertEmail.mock.calls[1]?.[3]).toMatchObject({ kind: 'recovered' });

      // swap_active is an info rule: it opens an incident but sends no mail.
      sendFleetAlertEmail.mockClear();
      const quiet = await monitoredWorker('mailquiet');
      await beat(quiet.id);
      const swapping = async (at: number) => {
        await latest(quiet.id, at, {});
        const body = JSON.parse((await app.redis.get(fleetAgentLatestKey(quiet.id))) as string);
        body.host.swapUsedMib = 4096;
        await app.redis.set(fleetAgentLatestKey(quiet.id), JSON.stringify(body), 'EX', 600);
        await runFleetEvaluatorTick(app, { now: at });
      };
      await swapping(T0 + 2000 * S);
      await swapping(T0 + 2601 * S);
      expect((await incidents(quiet.id)).map((i) => i.ruleKey)).toContain('swap_active');
      expect(sendFleetAlertEmail).not.toHaveBeenCalled();
    } finally {
      env.FLEET_ALERT_EMAILS = undefined;
    }
  });

  it('opens thermal_collapse only after it is sustained, with evidence, and recovers after clearing', async () => {
    const { id } = await monitoredWorker('thermal');
    await beat(id);
    const hot = { tempC: 87, smClockMhz: 900 };

    await latest(id, T0, hot);
    await runFleetEvaluatorTick(app, { now: T0 });
    await latest(id, T0 + 179 * S, hot);
    await runFleetEvaluatorTick(app, { now: T0 + 179 * S });
    expect(await incidents(id)).toHaveLength(0);

    await latest(id, T0 + 180 * S, hot);
    await runFleetEvaluatorTick(app, { now: T0 + 180 * S });
    const [inc] = await incidents(id);
    expect(inc).toMatchObject({ ruleKey: 'thermal_collapse', state: 'OPEN', severity: 'warning' });
    expect(inc?.evidence).toMatchObject({ gpuIndex: 0, tempC: 87, smClockMhz: 900 });

    await latest(id, T0 + 200 * S);
    await runFleetEvaluatorTick(app, { now: T0 + 200 * S });
    await latest(id, T0 + 319 * S);
    await runFleetEvaluatorTick(app, { now: T0 + 319 * S });
    expect((await incidents(id))[0]?.state).toBe('OPEN');
    await latest(id, T0 + 320 * S);
    await runFleetEvaluatorTick(app, { now: T0 + 320 * S });
    expect((await incidents(id))[0]?.state).toBe('RECOVERED');
  });

  it('thermal_slowdown reads the rise of the driver counter and treats a reset as unknown', async () => {
    const seed = (id: string, rows: { at: number; hw: number | null }[]) =>
      app.db.insert(schema.fleetGpuSamples).values(
        rows.map((r) => ({
          workerId: id,
          observedAt: new Date(r.at),
          gpuIndex: 0,
          hwThermalSlowdownUs: r.hw,
        })),
      );
    const NOW = T0 + 1000 * S;

    // 45 s of slowdown over 10 minutes: opens (limit 30 s) once it has lasted the rule window.
    const slow = await monitoredWorker('slow');
    await beat(slow.id);
    await latest(slow.id, NOW);
    await seed(slow.id, [
      { at: NOW - 600 * S, hw: 1_000_000 },
      { at: NOW - 300 * S, hw: 20_000_000 },
      { at: NOW - 2 * S, hw: 46_000_000 },
    ]);
    await runFleetEvaluatorTick(app, { now: NOW });
    await latest(slow.id, NOW + 60 * S);
    await runFleetEvaluatorTick(app, { now: NOW + 60 * S });
    const [inc] = await incidents(slow.id);
    expect(inc).toMatchObject({ ruleKey: 'thermal_slowdown', state: 'OPEN', severity: 'warning' });
    expect(inc?.evidence).toMatchObject({ slowedSeconds: 45, limitSeconds: 30 });

    // A counter that fell (driver reload) and a single reading both say "cannot tell": the worker
    // is absent from the result, so the rule reads unknown and cannot recover a live incident.
    const reset = await monitoredWorker('reset');
    await seed(reset.id, [
      { at: NOW - 300 * S, hw: 900_000_000 },
      { at: NOW - 2 * S, hw: 1_000 },
    ]);
    const lone = await monitoredWorker('lone');
    await seed(lone.id, [{ at: NOW - 2 * S, hw: 900_000_000 }]);
    const nulls = await monitoredWorker('nulls');
    await seed(nulls.id, [
      { at: NOW - 300 * S, hw: null },
      { at: NOW - 2 * S, hw: null },
    ]);
    const got = await thermalSlowedByWorker(app, [slow.id, reset.id, lone.id, nulls.id], NOW);
    expect(got.get(slow.id)).toBe(45_000);
    expect(got.has(reset.id)).toBe(false);
    expect(got.has(lone.id)).toBe(false);
    expect(got.has(nulls.id)).toBe(false);
  });

  it('a flapping signal opens nothing and a telemetry gap does not recover a live incident', async () => {
    const { id } = await monitoredWorker('flap');
    await beat(id);
    for (let i = 0; i < 30; i++) {
      const now = T0 + i * 15 * S;
      await latest(id, now, i % 2 === 0 ? { tempC: 90, smClockMhz: 800 } : {});
      await runFleetEvaluatorTick(app, { now });
    }
    expect(await incidents(id)).toHaveLength(0);

    // Now a sustained breach opens it...
    const base = T0 + 1000 * S;
    for (const dt of [0, 181]) {
      await latest(id, base + dt * S, { tempC: 90, smClockMhz: 800 });
      await runFleetEvaluatorTick(app, { now: base + dt * S });
    }
    expect((await incidents(id))[0]?.state).toBe('OPEN');
    // ...and the latest sample expiring (stale telemetry) for an hour recovers nothing.
    await app.redis.del(fleetAgentLatestKey(id));
    for (let i = 0; i < 20; i++) {
      await runFleetEvaluatorTick(app, { now: base + (300 + i * 180) * S });
    }
    expect((await incidents(id))[0]?.state).toBe('OPEN');
  });

  it('comfy_down_box_up needs a live agent and a fresh failing dispatcher probe', async () => {
    const { id } = await monitoredWorker('comfy');
    await beat(id);
    await app.redis.del(`worker:health:${id}`);

    // No dispatcher snapshot at all: unknown, so nothing opens.
    await runFleetEvaluatorTick(app, { now: T0 });
    await runFleetEvaluatorTick(app, { now: T0 + 120 * S });
    expect(await incidents(id)).toHaveLength(0);

    const snap = (at: number) =>
      app.redis.set(
        `worker:queue:${id}`,
        JSON.stringify({ probedAt: at, error: 'fetch failed' }),
        'EX',
        600,
      );
    await snap(T0 + 200 * S);
    await runFleetEvaluatorTick(app, { now: T0 + 200 * S });
    await snap(T0 + 261 * S);
    await runFleetEvaluatorTick(app, { now: T0 + 261 * S });
    const rows = await incidents(id);
    expect(rows.map((r) => r.ruleKey)).toEqual(['comfy_down_box_up']);
    expect(rows[0]?.severity).toBe('critical');
  });

  it('box_unreachable opens when the agent is silent AND the dispatcher cannot reach the box', async () => {
    const { id } = await monitoredWorker('box');
    await noBeat(id);
    await app.redis.del(`worker:health:${id}`);
    const snap = (at: number) =>
      app.redis.set(
        `worker:queue:${id}`,
        JSON.stringify({ probedAt: at, error: 'timeout' }),
        'EX',
        600,
      );
    for (const dt of [100, 160, 221]) {
      await snap(T0 + dt * S);
      await runFleetEvaluatorTick(app, { now: T0 + dt * S });
    }
    const keys = (await incidents(id)).map((r) => r.ruleKey).sort();
    expect(keys).toEqual(['agent_silent', 'box_unreachable']);
  });

  it('ingest_rejected opens at once when the counter reaches the limit', async () => {
    const { id } = await monitoredWorker('rejects');
    await beat(id);
    await app.redis.set(fleetAgentRejectsKey(id), '12', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 });
    const [inc] = await incidents(id);
    expect(inc).toMatchObject({ ruleKey: 'ingest_rejected', state: 'OPEN' });
    expect(inc?.evidence).toMatchObject({ rejectsLastHour: 12 });
  });

  it('two evaluators ticking at once open exactly one incident', async () => {
    const { id } = await monitoredWorker('race');
    await beat(id);
    await app.redis.set(fleetAgentRejectsKey(id), '50', 'EX', 600);
    await Promise.all([
      runFleetEvaluatorTick(app, { now: T0 }),
      runFleetEvaluatorTick(app, { now: T0 }),
      runFleetEvaluatorTick(app, { now: T0 }),
    ]);
    const rows = await incidents(id);
    expect(rows).toHaveLength(1);
    expect(await events(rows[0]?.id ?? '')).toEqual(['OPENED']);
  });

  it('recovers live incidents when the key is revoked or the rule is disabled, and does not evaluate unmonitored workers', async () => {
    const a = await monitoredWorker('revoked');
    await beat(a.id);
    await app.redis.set(fleetAgentRejectsKey(a.id), '50', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 });
    expect((await incidents(a.id))[0]?.state).toBe('OPEN');
    await app.db
      .update(schema.fleetAgents)
      .set({ revokedAt: new Date() })
      .where(eq(schema.fleetAgents.id, a.keyId));
    await runFleetEvaluatorTick(app, { now: T0 + 10 * S });
    const [inc] = await incidents(a.id);
    expect(inc?.state).toBe('RECOVERED');
    const ev = await app.db
      .select()
      .from(schema.fleetIncidentEvents)
      .where(eq(schema.fleetIncidentEvents.incidentId, inc?.id ?? ''));
    expect(ev.at(-1)?.text).toMatch(/no longer monitored/);
    // A revoked worker is not evaluated again.
    await runFleetEvaluatorTick(app, { now: T0 + 20 * S });
    expect(await incidents(a.id)).toHaveLength(1);

    const b = await monitoredWorker('disabled');
    await beat(b.id);
    await app.redis.set(fleetAgentRejectsKey(b.id), '50', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 });
    expect((await incidents(b.id))[0]?.state).toBe('OPEN');
    await app.db
      .update(schema.fleetAlertRules)
      .set({ enabled: false })
      .where(eq(schema.fleetAlertRules.key, 'ingest_rejected'));
    try {
      await runFleetEvaluatorTick(app, { now: T0 + 10 * S });
      expect((await incidents(b.id))[0]?.state).toBe('RECOVERED');
      // Disabled: a new breach does not reopen.
      const n = (await incidents(b.id)).length;
      await runFleetEvaluatorTick(app, { now: T0 + 20 * S });
      expect(await incidents(b.id)).toHaveLength(n);
    } finally {
      await app.db
        .update(schema.fleetAlertRules)
        .set({ enabled: true })
        .where(eq(schema.fleetAlertRules.key, 'ingest_rejected'));
    }
  });

  it('opens a new incident (new timeline) when a problem recurs after recovery', async () => {
    const { id } = await monitoredWorker('recur');
    await beat(id);
    const rk = fleetAgentRejectsKey(id);
    await app.redis.set(rk, '50', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 });
    await app.redis.set(rk, '0', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 + 10 * S });
    await runFleetEvaluatorTick(app, { now: T0 + 611 * S }); // 600 s clear window
    expect((await incidents(id))[0]?.state).toBe('RECOVERED');
    await app.redis.set(rk, '50', 'EX', 600);
    await runFleetEvaluatorTick(app, { now: T0 + 700 * S });
    const rows = await incidents(id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.state === 'OPEN')).toHaveLength(1);
  });

  it('a maintenance window stops new incidents, escalations and emails for that worker only', async () => {
    const quiet = await monitoredWorker('mw-quiet');
    const loud = await monitoredWorker('mw-loud');
    for (const w of [quiet, loud]) {
      await beat(w.id);
      await app.redis.set(fleetAgentRejectsKey(w.id), '50', 'EX', 600);
    }
    const win = await app.db
      .insert(schema.fleetMaintenanceWindows)
      .values({
        workerId: quiet.id,
        startsAt: new Date(T0 - 60 * S),
        endsAt: new Date(T0 + 3600 * S),
        owner: 'test',
        reason: 'planned',
      })
      .returning({ id: schema.fleetMaintenanceWindows.id });
    const env = app.env as { FLEET_ALERT_EMAILS?: string };
    env.FLEET_ALERT_EMAILS = 'ops@example.com';
    sendFleetAlertEmail.mockClear();
    try {
      const tick = await runFleetEvaluatorTick(app, { now: T0 });
      expect(tick.opened).toBe(1);
      expect(await incidents(quiet.id)).toHaveLength(0);
      expect(await incidents(loud.id)).toHaveLength(1);
      await vi.waitFor(() => expect(sendFleetAlertEmail).toHaveBeenCalled());
      const mailed = sendFleetAlertEmail.mock.calls.map((c) => JSON.stringify(c));
      expect(mailed.some((m) => m.includes(quiet.id))).toBe(false);

      // The window ends (cancelled): the same breach now opens.
      await app.db
        .update(schema.fleetMaintenanceWindows)
        .set({ state: 'CANCELLED' })
        .where(eq(schema.fleetMaintenanceWindows.id, win[0]?.id as string));
      await runFleetEvaluatorTick(app, { now: T0 + 10 * S });
      expect(await incidents(quiet.id)).toHaveLength(1);
    } finally {
      env.FLEET_ALERT_EMAILS = undefined;
    }
  });
});
