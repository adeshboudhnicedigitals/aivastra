import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { FLEET_RAW_RETENTION_MS } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFleetRetentionTick } from '../../src/modules/fleet/retention';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const HOUR = 60 * 60 * 1000;

describe('fleet raw sample retention', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  let seq = 0;
  /** One host row and one GPU row observed `ageMs` ago for `workerId`. */
  async function addSample(workerId: string, ageMs: number) {
    const observedAt = new Date(Date.now() - ageMs);
    await app.db.insert(schema.fleetHostSamples).values({
      workerId,
      observedAt,
      bootId: 'boot-retention',
      seq: ++seq,
      agentVersion: '0.1.0',
      clockSkewMs: 10,
      disks: [],
      services: [],
      comfy: [],
      computeApps: [],
    });
    await app.db.insert(schema.fleetGpuSamples).values({ workerId, observedAt, gpuIndex: 0 });
  }
  const counts = async (workerId: string) => ({
    host: (
      await app.db
        .select({ id: schema.fleetHostSamples.id })
        .from(schema.fleetHostSamples)
        .where(eq(schema.fleetHostSamples.workerId, workerId))
    ).length,
    gpu: (
      await app.db
        .select({ id: schema.fleetGpuSamples.id })
        .from(schema.fleetGpuSamples)
        .where(eq(schema.fleetGpuSamples.workerId, workerId))
    ).length,
  });
  const id = (name: string) => `ret-${randomUUID().slice(0, 8)}-${name}`;

  it('uses a 48 hour window by default', () => {
    expect(FLEET_RAW_RETENTION_MS).toBe(48 * HOUR);
  });

  it('deletes samples older than the window from both tables and keeps the rest', async () => {
    const w = id('window');
    await addSample(w, 49 * HOUR);
    await addSample(w, 72 * HOUR);
    await addSample(w, 47 * HOUR);
    await addSample(w, 1 * HOUR);
    await addSample(w, 0);
    expect(await counts(w)).toEqual({ host: 5, gpu: 5 });

    const result = await runFleetRetentionTick(app);
    expect(result.complete).toBe(true);
    expect(result.deleted.fleet_host_samples).toBeGreaterThanOrEqual(2);
    expect(result.deleted.fleet_gpu_samples).toBeGreaterThanOrEqual(2);
    expect(await counts(w)).toEqual({ host: 3, gpu: 3 });
  });

  it('is a no-op the second time', async () => {
    const w = id('idem');
    await addSample(w, 100 * HOUR);
    await addSample(w, 1 * HOUR);
    await runFleetRetentionTick(app);
    const again = await runFleetRetentionTick(app);
    expect(again.deleted).toEqual({ fleet_gpu_samples: 0, fleet_host_samples: 0 });
    expect(await counts(w)).toEqual({ host: 1, gpu: 1 });
  });

  it('works through a backlog in bounded batches and reports when it is not finished', async () => {
    const w = id('backlog');
    for (let i = 0; i < 7; i++) await addSample(w, (60 + i) * HOUR);
    await addSample(w, 1 * HOUR);

    // Two rows per pass and only two passes: four of the seven old rows go, three remain.
    const first = await runFleetRetentionTick(app, { batchSize: 2, maxBatches: 2 });
    expect(first.complete).toBe(false);
    const left = await counts(w);
    expect(left.host).toBeGreaterThan(1);
    expect(left.host).toBeLessThan(8);

    // The next ticks finish the job without touching the recent row.
    for (let i = 0; i < 20; i++) {
      const r = await runFleetRetentionTick(app, { batchSize: 2, maxBatches: 2 });
      if (r.complete) break;
    }
    expect(await counts(w)).toEqual({ host: 1, gpu: 1 });
  });

  it('honours an explicit window and does not touch other tables', async () => {
    const w = id('custom');
    await addSample(w, 3 * HOUR);
    await addSample(w, 30 * 60 * 1000);
    await runFleetRetentionTick(app, { maxAgeMs: 2 * HOUR });
    expect(await counts(w)).toEqual({ host: 1, gpu: 1 });

    // Keys are credentials, not samples: retention must never remove them.
    const agentsBefore = await app.db
      .select({ id: schema.fleetAgents.id })
      .from(schema.fleetAgents);
    await runFleetRetentionTick(app, { maxAgeMs: 0 });
    const agentsAfter = await app.db.select({ id: schema.fleetAgents.id }).from(schema.fleetAgents);
    expect(agentsAfter.length).toBe(agentsBefore.length);
  });
});
