import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// A job with an in-job pre-step (garment extract) submits to ComfyUI once per phase, but
// jobs.worker_id holds only one worker. The admin jobs list/detail derive per-stage workers
// from execution_attempts so the panel can show "S1: w1 · S2: w3".
describe('admin jobs — per-stage workers (garment extract)', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  let n = 0;
  async function seedJob(
    attempts: {
      phase: string;
      attemptNo: number;
      state: string;
      workerId: string;
      resolved?: boolean;
    }[],
  ) {
    const tag = `${Date.now()}-${n++}`;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `stages-${tag}@x.com`, emailVerified: true, tier: 'free' })
      .returning();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId: user?.id,
        status: 'COMPLETED',
        priority: false,
        creditsCharged: 35,
        workerId: 'w3',
      })
      .returning();
    const jobId = job?.id as string;
    await app.db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: `inputs/${jobId}/garment.jpg`,
      params: {},
    });
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId, resultKey: `outputs/${jobId}/result.png` });
    for (const a of attempts) {
      await app.db.insert(schema.executionAttempts).values({
        jobId,
        attemptNo: a.attemptNo,
        phase: a.phase,
        clientId: `av:${jobId}:${a.attemptNo}:${a.phase}`,
        state: a.state,
        workerId: a.workerId,
        promptId: a.state === 'SUCCEEDED' ? `p-${a.attemptNo}-${a.phase}` : undefined,
        resolvedAt: a.resolved ? new Date() : undefined,
        contract: {},
      });
    }
    return jobId;
  }

  const getDetail = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/admin/jobs/${id}`, headers })).json();

  it('reports both stages with their own workers, ordered extract then generation', async () => {
    const jobId = await seedJob([
      { phase: 'main', attemptNo: 2, state: 'SUCCEEDED', workerId: 'w3', resolved: true },
      {
        phase: 'garment_extract',
        attemptNo: 1,
        state: 'SUCCEEDED',
        workerId: 'w1',
        resolved: true,
      },
    ]);

    const detail = await getDetail(jobId);
    expect(detail.stages.map((s: { workerId: string }) => s.workerId)).toEqual(['w1', 'w3']);
    expect(detail.stages.map((s: { stage: number }) => s.stage)).toEqual([1, 2]);
    expect(detail.stages[0]).toMatchObject({
      phase: 'garment_extract',
      label: 'Garment extraction',
      state: 'done',
    });
    // Stage 1 read the raw upload and produced the ghost mannequin; stage 2 consumed that
    // (not the raw upload) and produced the job output.
    expect(detail.stages[0].inputUrl).toContain(`inputs/${jobId}/garment.jpg`);
    expect(detail.stages[0].outputUrl).toContain(
      `outputs/${jobId}/garment-extract-intermediate.png`,
    );
    expect(detail.stages[1].inputUrl).toContain(
      `outputs/${jobId}/garment-extract-intermediate.png`,
    );
    expect(detail.stages[1].outputUrl).toContain(`outputs/${jobId}/result.png`);

    const list = (
      await app.inject({ method: 'GET', url: `/admin/jobs?search=${jobId}`, headers })
    ).json();
    const row = list.items.find((i: { id: string }) => i.id === jobId);
    expect(row.stages.map((s: { workerId: string }) => s.workerId)).toEqual(['w1', 'w3']);
  });

  it('shows the latest attempt per phase, a retry count, and withholds outputs of a failed stage', async () => {
    const jobId = await seedJob([
      {
        phase: 'garment_extract',
        attemptNo: 1,
        state: 'SUCCEEDED',
        workerId: 'w1',
        resolved: true,
      },
      { phase: 'main', attemptNo: 2, state: 'FAILED', workerId: 'w2' },
      { phase: 'main', attemptNo: 3, state: 'FAILED', workerId: 'w4' },
    ]);

    const detail = await getDetail(jobId);
    const main = detail.stages[1];
    expect(main).toMatchObject({ phase: 'main', workerId: 'w4', state: 'failed', attempts: 2 });
    expect(main.endedAt).not.toBeNull();
    expect(main.outputUrl).toBeUndefined();
  });

  it('shows stage 1 as reused for a pose that took its sibling’s extraction', async () => {
    // This job never ran an extraction itself: no garment_extract attempt, only the event the
    // dispatcher recorded when it copied the sibling's result.
    const jobId = await seedJob([
      { phase: 'main', attemptNo: 1, state: 'SUCCEEDED', workerId: 'w3', resolved: true },
    ]);
    const sourceJobId = '11111111-2222-4333-8444-555555555555';
    await app.db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'GARMENT_EXTRACT_REUSED',
      payload: { sourceJobId, workerId: 'w1', sourceKey: `outputs/${sourceJobId}/x.png` },
    });

    const detail = await getDetail(jobId);
    expect(detail.stages.map((st: { stage: number }) => st.stage)).toEqual([1, 2]);
    expect(detail.stages[0]).toMatchObject({
      phase: 'garment_extract',
      state: 'done',
      workerId: 'w1',
      reusedFromJobId: sourceJobId,
    });
    // It holds its own copy, so the output link points at this job's checkpoint.
    expect(detail.stages[0].outputUrl).toContain(
      `outputs/${jobId}/garment-extract-intermediate.png`,
    );
    expect(detail.stages[1].inputUrl).toContain(
      `outputs/${jobId}/garment-extract-intermediate.png`,
    );
  });

  it('omits stages for an ordinary single-phase job', async () => {
    const jobId = await seedJob([
      { phase: 'main', attemptNo: 1, state: 'SUCCEEDED', workerId: 'w3', resolved: true },
    ]);
    const detail = await getDetail(jobId);
    expect(detail.stages).toBeUndefined();
    expect(detail.workerId).toBe('w3');

    const noAttempts = await seedJob([]);
    expect((await getDetail(noAttempts)).stages).toBeUndefined();
  });
});
