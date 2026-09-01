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
