import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

/**
 * GET /admin/jobs/:id — workflowLabel precedence.
 *
 * "What workflow actually ran" must come from history, never from today's live
 * pose/garment-config join: that join reflects current config, which an admin can
 * change at any time after the job dispatched. Two historical sources exist,
 * checked in order:
 *   1. job_inputs.params.workflowTemplateId — snapshotted at job creation for most
 *      job types.
 *   2. The most recent COMFY_DISPATCH job_events row's payload.workflowTemplateId —
 *      the only historical record for job types (merchant-catalog, bare
 *      saree-mannequin) that deliberately omit the params snapshot so the
 *      dispatcher can re-resolve the workflow fresh at dispatch time.
 * Only a job that never reached dispatch falls back to the live join.
 */
describe('GET /admin/jobs/:id — workflowLabel precedence', () => {
  let c: Containers;
  let app: TestApp;
  let adminHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedWorkflowTemplate(label: string) {
    const [wt] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `wt-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label,
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    if (!wt) throw new Error('failed to seed workflow template');
    return wt;
  }

  async function seedPose(defaultWorkflowTemplateId: string) {
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `pose-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        r2Key: 'poses/stub.jpg',
        thumbnailKey: 'poses/stub-thumb.jpg',
        workflowTemplateId: defaultWorkflowTemplateId,
      })
      .returning();
    if (!pose) throw new Error('failed to seed pose');
    return pose;
  }

  async function seedJob(status: string, params: Record<string, unknown>, poseId?: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ status, creditsCharged: 1, source: 'merchant_catalog' })
      .returning();
    if (!job) throw new Error('failed to seed job');
    await app.db.insert(schema.jobInputs).values({
      jobId: job.id,
      poseId: poseId ?? null,
      params,
    });
    return job;
  }

  async function seedDispatchEvent(jobId: string, workflowTemplateId: string, createdAt: Date) {
    await app.db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: { workflowTemplateId },
      createdAt,
    });
  }

  async function getJobDetail(jobId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/jobs/${jobId}`,
      headers: adminHeader,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('prefers params.workflowTemplateId over the live pose join', async () => {
    const liveTemplate = await seedWorkflowTemplate('Live Default Workflow');
    const historicalTemplate = await seedWorkflowTemplate('Historical Snapshot Workflow');
    const pose = await seedPose(liveTemplate.id);
    // The pose's default workflow has since been repointed to a different template
    // than the one this job actually recorded at creation time.
    const job = await seedJob(
      'COMPLETED',
      { kind: 'tryon', workflowTemplateId: historicalTemplate.id },
      pose.id,
    );

    const body = await getJobDetail(job.id);
    expect(body.workflowLabel).toBe('Historical Snapshot Workflow');
  });

  it('falls back to the most recent COMFY_DISPATCH event when params has no snapshot', async () => {
    const liveTemplate = await seedWorkflowTemplate('Live Default Workflow 2');
    const dispatchedTemplate = await seedWorkflowTemplate('Dispatched Workflow 2');
    const pose = await seedPose(liveTemplate.id);
    // merchant_catalog jobs never snapshot workflowTemplateId in params by design.
    const job = await seedJob('COMPLETED', { kind: 'merchant_catalog' }, pose.id);
    await seedDispatchEvent(job.id, dispatchedTemplate.id, new Date());

    const body = await getJobDetail(job.id);
    expect(body.workflowLabel).toBe('Dispatched Workflow 2');
  });

  it('uses the latest COMFY_DISPATCH event on a retried job, not the first attempt', async () => {
    const firstAttemptTemplate = await seedWorkflowTemplate('First Attempt Workflow');
    const retryTemplate = await seedWorkflowTemplate('Retry Workflow');
    const job = await seedJob('COMPLETED', { kind: 'merchant_catalog' });
    await seedDispatchEvent(job.id, firstAttemptTemplate.id, new Date(Date.now() - 60_000));
    await seedDispatchEvent(job.id, retryTemplate.id, new Date());

    const body = await getJobDetail(job.id);
    expect(body.workflowLabel).toBe('Retry Workflow');
  });

  it('falls back to the live pose join when the job never reached dispatch', async () => {
    const liveTemplate = await seedWorkflowTemplate('Live Default Workflow 3');
    const pose = await seedPose(liveTemplate.id);
    const job = await seedJob('HELD', { kind: 'merchant_catalog' }, pose.id);

    const body = await getJobDetail(job.id);
    expect(body.workflowLabel).toBe('Live Default Workflow 3');
  });
});

/**
 * GET /admin/jobs/:id — dispatchedGarmentPrompt/dispatchedFacePrompt.
 *
 * The actual text ComfyUI received, extracted from the COMFY_DISPATCH event's
 * `payload.prompt` (the full patched graph) at the resolved workflow's own
 * garmentPhasePromptNode/facePhasePromptNode — not `payload.inputs.
 * promptGarmentPhase`, which is only the per-job OVERRIDE (null whenever the
 * job used the template's own baked-in default, which is the common case).
 */
describe('GET /admin/jobs/:id — dispatched prompt extraction', () => {
  let c: Containers;
  let app: TestApp;
  let adminHeader: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedWorkflowTemplate(
    label: string,
    overrides: Partial<typeof schema.workflowTemplates.$inferInsert> = {},
  ) {
    const [wt] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `wt-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label,
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
        ...overrides,
      })
      .returning();
    if (!wt) throw new Error('failed to seed workflow template');
    return wt;
  }

  async function seedJob(params: Record<string, unknown>) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ status: 'COMPLETED', creditsCharged: 1, source: 'merchant_catalog' })
      .returning();
    if (!job) throw new Error('failed to seed job');
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, params });
    return job;
  }

  async function seedDispatchEvent(
    jobId: string,
    workflowTemplateId: string,
    prompt: Record<string, { inputs?: Record<string, unknown> }>,
    extraInputs: Record<string, unknown> = {},
  ) {
    await app.db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: {
        workflowTemplateId,
        prompt,
        inputs: { promptGarmentPhase: null, ...extraInputs },
      },
    });
  }

  async function getJobDetail(jobId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/jobs/${jobId}`,
      headers: adminHeader,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('extracts the positive prompt text from the dispatched graph, not from the null per-job override', async () => {
    const template = await seedWorkflowTemplate('Dispatched Prompt Template');
    const job = await seedJob({ kind: 'merchant_catalog' });
    await seedDispatchEvent(job.id, template.id, {
      2: { inputs: { prompt: 'the actual text sent to ComfyUI' } },
    });

    const body = await getJobDetail(job.id);
    expect(body.dispatchedGarmentPrompt).toBe('the actual text sent to ComfyUI');
  });

  it('reads the "text" input key for a standard CLIPTextEncode-shaped node, not just "prompt"', async () => {
    const template = await seedWorkflowTemplate('Text Key Template');
    const job = await seedJob({ kind: 'merchant_catalog' });
    await seedDispatchEvent(job.id, template.id, {
      2: { inputs: { text: 'clip text encode style prompt' } },
    });

    const body = await getJobDetail(job.id);
    expect(body.dispatchedGarmentPrompt).toBe('clip text encode style prompt');
  });

  it('extracts the negative prompt from facePhasePromptNode when present', async () => {
    const template = await seedWorkflowTemplate('Negative Prompt Template', {
      facePhasePromptNode: '3',
    });
    const job = await seedJob({ kind: 'merchant_catalog' });
    await seedDispatchEvent(job.id, template.id, {
      2: { inputs: { prompt: 'positive text' } },
      3: { inputs: { prompt: 'negative text' } },
    });

    const body = await getJobDetail(job.id);
    expect(body.dispatchedGarmentPrompt).toBe('positive text');
    expect(body.dispatchedFacePrompt).toBe('negative text');
  });

  it('is null when the job has not dispatched yet', async () => {
    const template = await seedWorkflowTemplate('Undispatched Template');
    const job = await seedJob({ kind: 'merchant_catalog', workflowTemplateId: template.id });

    const body = await getJobDetail(job.id);
    expect(body.dispatchedGarmentPrompt ?? null).toBeNull();
    expect(body.dispatchedFacePrompt ?? null).toBeNull();
    expect(body.dispatchedAspectRatio ?? null).toBeNull();
    expect(body.dispatchedOutputWidth ?? null).toBeNull();
    expect(body.dispatchedOutputHeight ?? null).toBeNull();
  });

  it('extracts the dispatched aspect ratio and output dimensions', async () => {
    const template = await seedWorkflowTemplate('Sizing Template');
    const job = await seedJob({ kind: 'merchant_catalog' });
    await seedDispatchEvent(
      job.id,
      template.id,
      { 2: { inputs: { prompt: 'positive text' } } },
      { aspectRatio: '1:1', outputWidth: 2688, outputHeight: 2688 },
    );

    const body = await getJobDetail(job.id);
    expect(body.dispatchedAspectRatio).toBe('1:1');
    expect(body.dispatchedOutputWidth).toBe(2688);
    expect(body.dispatchedOutputHeight).toBe(2688);
  });
});
