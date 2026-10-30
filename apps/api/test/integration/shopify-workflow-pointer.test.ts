import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('Shopify workflow pointer safety', () => {
  let c: Containers;
  let app: TestApp;
  let proposalHeaders: Record<string, string>;
  let approvalHeaders: Record<string, string>;

  const jsonContent = {
    pose_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'pose' } },
    lower_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'lower' } },
    positive_node: {
      inputs: { prompt: 'default' },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'positive_prompt' },
    },
  };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    proposalHeaders = await adminAuthHeader(app, 'MODERATOR');
    approvalHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedWorkflow(slug: string) {
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug,
        label: slug,
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        upperNodeIds: [],
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      })
      .returning();
    return workflow;
  }

  async function approveReplacement(targetWorkflowId: string) {
    const proposedFields = {
      slug: `replacement_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      label: 'Replacement workflow',
      jsonContent,
      workflowType: 'regular',
      poseNodeId: 'pose_node',
      lowerNodeId: 'lower_node',
      garmentPhasePromptNode: 'positive_node',
    };
    const proposal = await app.inject({
      method: 'POST',
      url: '/admin/workflow-change-requests',
      headers: proposalHeaders,
      payload: {
        changeType: 'create',
        targetWorkflowId,
        reason:
          'New graph fixes draping — the sampler now respects fabric weight so loose garments no longer clip through the mannequin during generation.',
        previousLimitations:
          'Old graph mishandled loose fabric: any garment with drape or flow would clip through the mannequin body in a large share of generations.',
        proposedFields,
      },
    });
    expect(proposal.statusCode).toBe(200);
    const approval = await app.inject({
      method: 'POST',
      url: `/admin/workflow-change-requests/${proposal.json().id}/approve`,
      headers: approvalHeaders,
      payload: {},
    });
    expect(approval.statusCode).toBe(200);
    return approval.json() as { resultingWorkflowId: string };
  }

  it('moves the pointer from a replaced workflow to the resulting workflow', async () => {
    const target = await seedWorkflow(`pointer-target-${Date.now()}`);
    await app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: target.id }));
    const result = await approveReplacement(target.id);
    const config = JSON.parse((await app.redis.get('config:system')) ?? '{}');
    expect(config.shopifyWorkflowTemplateId).toBe(result.resultingWorkflowId);
  });

  it('leaves an unrelated Shopify pointer unchanged during replacement', async () => {
    const target = await seedWorkflow(`pointer-target-other-${Date.now()}`);
    const unrelated = await seedWorkflow(`pointer-unrelated-${Date.now()}`);
    await app.redis.set(
      'config:system',
      JSON.stringify({ shopifyWorkflowTemplateId: unrelated.id }),
    );
    await approveReplacement(target.id);
    const config = JSON.parse((await app.redis.get('config:system')) ?? '{}');
    expect(config.shopifyWorkflowTemplateId).toBe(unrelated.id);
  });

  it('refuses deletion of the configured Shopify workflow', async () => {
    const workflow = await seedWorkflow(`pointer-delete-configured-${Date.now()}`);
    await app.redis.set(
      'config:system',
      JSON.stringify({ shopifyWorkflowTemplateId: workflow.id }),
    );
    const response = await app.inject({
      method: 'DELETE',
      url: `/admin/workflows/${workflow.id}`,
      headers: approvalHeaders,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('Shopify workflow');
  });

  it('deletes an unrelated workflow with no references', async () => {
    const workflow = await seedWorkflow(`pointer-delete-unrelated-${Date.now()}`);
    await app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: null }));
    const response = await app.inject({
      method: 'DELETE',
      url: `/admin/workflows/${workflow.id}`,
      headers: approvalHeaders,
    });
    expect(response.statusCode).toBe(200);
    const rows = await app.db
      .select({ id: schema.workflowTemplates.id })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, workflow.id));
    expect(rows).toHaveLength(0);
  });
});
