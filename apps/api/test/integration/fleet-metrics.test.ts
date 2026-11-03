import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  FLEET_RAW_RETENTION_MS,
  FLEET_ROLLUP_RETENTION_MS,
  fleetMetricsSchema,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFleetRetentionTick } from '../../src/modules/fleet/retention';
import { runFleetRollupTick } from '../../src/modules/fleet/rollups';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const RUN = randomUUID().slice(0, 8);
const MIN = 60_000;
// A five-minute-aligned anchor a few hours back, so every test sample is "recent" and the
// coarser 5-minute bins (24h window) never split the minutes a test expects to merge.
const BASE = Math.floor((Date.now() - 3 * 60 * MIN) / (5 * MIN)) * (5 * MIN);

describe('fleet rollups and metrics history', () => {
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

  let seq = 0;
  async function worker(name: string) {
    const id = `mt-${RUN}-${name}`;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: {
        id,
        label: 'metrics',
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
    return id;
  }
  async function sample(
    workerId: string,
    at: number,
    gpu: {
      tempC: number | null;
      smClockMhz?: number | null;
      powerW?: number | null;
      vram?: number | null;
      hwThermalUs?: number | null;
    },
    host: { ramAvailMib?: number | null; swapUsedMib?: number | null; load1?: number | null } = {},
    gpuIndex = 0,
  ) {
    const observedAt = new Date(at);
    await app.db.insert(schema.fleetHostSamples).values({
      workerId,
      observedAt,
      bootId: 'boot-metrics',
      seq: ++seq,
      agentVersion: '0.1.0',
      clockSkewMs: 0,
      load1: host.load1 ?? null,
      ramAvailMib: host.ramAvailMib ?? null,
      swapUsedMib: host.swapUsedMib ?? null,
      disks: [],
      services: [],
      comfy: [],
      computeApps: [],
    });
    await app.db.insert(schema.fleetGpuSamples).values({
      workerId,
      observedAt,
      gpuIndex,
      tempC: gpu.tempC,
      smClockMhz: gpu.smClockMhz ?? null,
      powerW: gpu.powerW ?? null,
      vramUsedMib: gpu.vram ?? null,
      hwThermalSlowdownUs: gpu.hwThermalUs ?? null,
    });
  }
  const metrics = async (id: string, window = '6h', headers = superAuth) =>
    app.inject({
      method: 'GET',
      url: `/admin/fleet/workers/${id}/metrics?window=${window}`,
      headers,
    });

  it('aggregates raw samples into one row per minute with avg/max/min and a sample count', async () => {
    const id = await worker('agg');
    await sample(
      id,
      BASE + 1_000,
      { tempC: 60, smClockMhz: 2400, powerW: 100, vram: 1000 },
      { ramAvailMib: 5000, load1: 1 },
    );
    await sample(
      id,
      BASE + 16_000,
      { tempC: 80, smClockMhz: 1200, powerW: 300, vram: 3000 },
      { ramAvailMib: 4000, load1: 3 },
    );
    await sample(id, BASE + MIN + 1_000, { tempC: 70 });
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });

    const rows = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.bucket.getTime() === BASE);
    expect(first).toMatchObject({
      n: 2,
      tempAvg: 70,
      tempMax: 80,
      smClockMin: 1200,
      powerMax: 300,
      vramUsedMax: 3000,
    });
    // A minute with only a temperature must not invent the other metrics.
    const second = rows.find((r) => r.bucket.getTime() === BASE + MIN);
    expect(second).toMatchObject({
      n: 1,
      tempAvg: 70,
      smClockAvg: null,
      powerAvg: null,
      vramUsedMax: null,
    });
    const host = await app.db
      .select()
      .from(schema.fleetHostRollups)
      .where(eq(schema.fleetHostRollups.workerId, id));
    expect(host.find((h) => h.bucket.getTime() === BASE)).toMatchObject({
      n: 2,
      load1Max: 3,
      ramAvailMin: 4000,
    });
  });

  it('is idempotent and picks up a late sample for an already-rolled minute', async () => {
    const id = await worker('late');
    await sample(id, BASE + 2_000, { tempC: 60 });
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });
    let [row] = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(row).toMatchObject({ n: 1, tempMax: 60 });
    await sample(id, BASE + 30_000, { tempC: 90 }); // spooled sample arrives afterwards
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });
    const rows = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(rows).toHaveLength(1);
    [row] = rows;
    expect(row).toMatchObject({ n: 2, tempMax: 90, tempAvg: 75 });
  });

  it('keeps history after retention deletes the raw rows', async () => {
    const id = await worker('retained');
    const old = Date.now() - 46 * 60 * MIN; // inside the 47 h backfill window, so it gets rolled up
    const oldMinute = Math.floor(old / MIN) * MIN;
    await sample(id, oldMinute + 1000, { tempC: 77 });
    await runFleetRollupTick(app, { lookbackMs: FLEET_RAW_RETENTION_MS - 60 * MIN });
    // Pretend 3 hours pass: the raw row (46 h old now) is then past the 48 h retention.
    await runFleetRetentionTick(app, { now: Date.now() + 3 * 60 * MIN });
    const raw = await app.db
      .select()
      .from(schema.fleetGpuSamples)
      .where(eq(schema.fleetGpuSamples.workerId, id));
    expect(raw).toHaveLength(0);
    const rolled = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ tempMax: 77 });
    // A later rollup pass over a recent window must not erase or shrink it.
    await runFleetRollupTick(app, { lookbackMs: 30 * MIN });
    const again = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(again[0]).toMatchObject({ n: 1, tempMax: 77 });
  });

  it('deletes rollups older than 30 days and nothing newer', async () => {
    const id = await worker('aged');
    const now = Date.now();
    const insert = (bucket: Date) =>
      app.db
        .insert(schema.fleetGpuRollups)
        .values({ workerId: id, gpuIndex: 0, bucket, n: 1, tempAvg: 1 });
    await insert(new Date(now - FLEET_ROLLUP_RETENTION_MS - 5 * MIN));
    await insert(new Date(now - FLEET_ROLLUP_RETENTION_MS + 5 * MIN));
    await runFleetRollupTick(app, { lookbackMs: MIN, now });
    const rows = await app.db
      .select()
      .from(schema.fleetGpuRollups)
      .where(eq(schema.fleetGpuRollups.workerId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bucket.getTime()).toBeGreaterThan(now - FLEET_ROLLUP_RETENTION_MS);
  });

  it('serves per-GPU series with gaps left as gaps, matching the response schema', async () => {
    const id = await worker('serve');
    await sample(id, BASE + 1000, { tempC: 60, smClockMhz: 2000 }, { ramAvailMib: 9000 }, 0);
    await sample(id, BASE + 2000, { tempC: 65 }, {}, 1);
    await sample(id, BASE + 10 * MIN + 1000, { tempC: 70, smClockMhz: 1000 }, {}, 0); // 9 minute gap
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });

    const res = await metrics(id, '6h');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public/);
    const body = fleetMetricsSchema.parse(res.json());
    expect(body).toMatchObject({ workerId: id, window: '6h', stepSeconds: 60 });
    expect(body.gpus.map((g) => g.index)).toEqual([0, 1]);
    const g0 = body.gpus[0]?.points ?? [];
    expect(g0.map((p) => new Date(p.t).getTime())).toEqual([BASE, BASE + 10 * MIN]); // no zero-filled minutes
    expect(g0[0]).toMatchObject({ tempAvg: 60, smClockAvg: 2000, powerAvg: null });
    expect(body.host[0]).toMatchObject({ ramAvailMin: 9000, swapUsedMax: null });
    expect(new Date(body.earliest ?? '').getTime()).toBe(BASE);
  });

  it('merges minutes into coarser steps weighted by sample count', async () => {
    const id = await worker('weighted');
    // Minute A: 1 sample at 10 C. Minute B: 3 samples at 30 C. Weighted mean = 25, not 20.
    await sample(id, BASE + 1000, { tempC: 10 });
    for (const dt of [1000, 2000, 3000]) await sample(id, BASE + MIN + dt, { tempC: 30 });
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });
    const res = await metrics(id, '24h'); // 5 minute step
    const body = fleetMetricsSchema.parse(res.json());
    expect(body.stepSeconds).toBe(300);
    const pts = body.gpus[0]?.points ?? [];
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ n: 4, tempAvg: 25, tempMax: 30 });
  });

  it('carries the driver slowdown counter through the rollup as the highest value per bucket', async () => {
    const id = await worker('slowdown');
    // Cumulative microseconds: the bucket keeps the largest reading, a bucket with none stays null.
    await sample(id, BASE + 1000, { tempC: 60, hwThermalUs: 5_000_000 });
    await sample(id, BASE + 30_000, { tempC: 60, hwThermalUs: 7_000_000 });
    await sample(id, BASE + MIN + 1000, { tempC: 60 });
    await runFleetRollupTick(app, { lookbackMs: 4 * 60 * MIN });
    const body = fleetMetricsSchema.parse((await metrics(id, '6h')).json());
    const pts = body.gpus[0]?.points ?? [];
    expect(pts[0]).toMatchObject({ hwThermalSlowdownUsMax: 7_000_000, swPowerCapUsMax: null });
    expect(pts[1]?.hwThermalSlowdownUsMax).toBeNull();
  });

  it('answers a worker with no data with empty series and earliest null, not zeros', async () => {
    const id = await worker('empty');
    const body = fleetMetricsSchema.parse((await metrics(id, '1h')).json());
    expect(body).toMatchObject({ gpus: [], host: [], earliest: null });
  });

  it('validates input and enforces permissions', async () => {
    const id = await worker('guard');
    expect((await metrics(id, '90d')).statusCode).toBe(400);
    expect((await metrics('nope-' + RUN, '1h')).statusCode).toBe(404);
    expect((await metrics(id, '1h', modAuth)).statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: `/admin/fleet/workers/${id}/metrics` });
    expect(anon.statusCode).toBe(401);
  });
});
