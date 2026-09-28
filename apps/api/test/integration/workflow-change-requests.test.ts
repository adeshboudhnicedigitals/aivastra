import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('workflow change requests - propose/approve', () => {
  let c: Containers;
  let app: TestApp;
  let superHeaders: Record<string, string>;
  let moderatorHeaders: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
    moderatorHeaders = await adminAuthHeader(app, 'MODERATOR');
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const jsonContent = {
    pose_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'pose' } },
    lower_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'lower' } },
    positive_node: {
      inputs: { prompt: 'default' },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'positive_prompt' },
    },
  };

  it('MODERATOR and ADMIN can parse a workflow JSON while proposing (read-only, no direct write access needed)', async () => {
    for (const headers of [moderatorHeaders, await adminAuthHeader(app, 'ADMIN')]) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workflows/parse',
        headers,
        payload: { jsonContent, workflowType: 'regular' },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('SUPPORT cannot parse a workflow JSON', async () => {
    const supportHeaders = await adminAuthHeader(app, 'SUPPORT');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows/parse',
      headers: supportHeaders,
      payload: { jsonContent, workflowType: 'regular' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('MODERATOR cannot write workflows directly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers: moderatorHeaders,
      payload: {
        slug: `direct_write_blocked_${Date.now()}`,
        label: 'Direct write blocked',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('approving a "create" proposal replaces the workflow and moves every existing mapping onto it', async () => {
    // Seed the workflow this proposal will replace.
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers: superHeaders,
      payload: {
        slug: `mapping_source_${Date.now()}`,
        label: 'Mapping source',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const oldWorkflowId = createRes.json().id as string;

    // Map a pose and a garment subcategory onto the old workflow, with pinned
    // prompt overrides that should be invalidated once the graph changes.
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `pose_${Date.now()}`,
        genderSlug: 'men',
        r2Key: 'k1',
        thumbnailKey: 'k1-thumb',
        workflowTemplateId: oldWorkflowId,
        promptGarmentPhase: 'old pinned garment prompt',
        promptFacePhase: 'old pinned face prompt',
      })
      .returning();
    expect(pose).toBeDefined();

    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'men',
        slug: `garment_${Date.now()}`,
        label: 'Test garment',
        mannequinWorkflowTemplateId: oldWorkflowId,
      })
      .returning();
    expect(garmentType).toBeDefined();

    // Propose a replacement as MODERATOR.
    const proposeRes = await app.inject({
      method: 'POST',
      url: '/admin/workflow-change-requests',
      headers: moderatorHeaders,
      payload: {
        changeType: 'create',
        targetWorkflowId: oldWorkflowId,
        reason: 'New graph fixes draping',
        previousLimitations: 'Old graph mishandled loose fabric',
        proposedFields: {
          slug: `mapping_replacement_${Date.now()}`,
          label: 'Mapping replacement',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      },
    });
    expect(proposeRes.statusCode).toBe(200);
    const changeRequestId = proposeRes.json().id as string;

    // MODERATOR cannot approve their own proposal.
    const moderatorApproveAttempt = await app.inject({
      method: 'POST',
      url: `/admin/workflow-change-requests/${changeRequestId}/approve`,
      headers: moderatorHeaders,
      payload: {},
    });
    expect(moderatorApproveAttempt.statusCode).toBe(403);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/admin/workflow-change-requests/${changeRequestId}/approve`,
      headers: superHeaders,
      payload: { reviewNote: 'Looks good' },
    });
    expect(approveRes.statusCode).toBe(200);
    const approved = approveRes.json();
    expect(approved.status).toBe('approved');
    const newWorkflowId = approved.resultingWorkflowId as string;
    expect(newWorkflowId).not.toBe(oldWorkflowId);

    // The old workflow is now inactive; the new one is active.
    const [oldRow] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, oldWorkflowId));
    const [newRow] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, newWorkflowId));
    expect(oldRow.isActive).toBe(false);
    expect(newRow.isActive).toBe(true);

    // The pose moved onto the new workflow, with its pinned prompts cleared.
    const [movedPose] = await app.db
      .select()
      .from(schema.modelPoseAssets)
      .where(eq(schema.modelPoseAssets.id, pose.id));
    expect(movedPose.workflowTemplateId).toBe(newWorkflowId);
    expect(movedPose.promptGarmentPhase).toBeNull();
    expect(movedPose.promptFacePhase).toBeNull();

    // The garment subcategory's mannequin-workflow slot moved too.
    const [movedGarmentType] = await app.db
      .select()
      .from(schema.garmentSubcategories)
      .where(eq(schema.garmentSubcategories.id, garmentType.id));
    expect(movedGarmentType.mannequinWorkflowTemplateId).toBe(newWorkflowId);

    // Version lineage continues across the two rows: the replaced row was never
    // itself versioned (implicit v1), so the new row's own first version is v2.
    const versionsRes = await app.inject({
      method: 'GET',
      url: `/admin/workflows/${newWorkflowId}/versions`,
      headers: superHeaders,
    });
    expect(versionsRes.statusCode).toBe(200);
    const versions = versionsRes.json();
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(2);
    expect(versions[0].changeRequestId).toBe(changeRequestId);

    // "Why is the old one inactive" points back at this exact change request.
    const replacedByRes = await app.inject({
      method: 'GET',
      url: `/admin/workflows/${oldWorkflowId}/replaced-by`,
      headers: superHeaders,
    });
    expect(replacedByRes.statusCode).toBe(200);
    expect(replacedByRes.json().replacedBy.resultingWorkflowId).toBe(newWorkflowId);
  });

  it('rejecting a proposal requires a review note and leaves the target workflow untouched', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers: superHeaders,
      payload: {
        slug: `reject_target_${Date.now()}`,
        label: 'Reject target',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const targetWorkflowId = createRes.json().id as string;

    const proposeRes = await app.inject({
      method: 'POST',
      url: '/admin/workflow-change-requests',
      headers: moderatorHeaders,
      payload: {
        changeType: 'update',
        targetWorkflowId,
        reason: 'Tweak label',
        previousLimitations: 'Label is unclear',
        proposedFields: { label: 'Renamed label' },
      },
    });
    const changeRequestId = proposeRes.json().id as string;

    const rejectWithoutNote = await app.inject({
      method: 'POST',
      url: `/admin/workflow-change-requests/${changeRequestId}/reject`,
      headers: superHeaders,
      payload: {},
    });
    expect(rejectWithoutNote.statusCode).toBe(400);

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/admin/workflow-change-requests/${changeRequestId}/reject`,
      headers: superHeaders,
      payload: { reviewNote: 'Not needed right now' },
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json().status).toBe('rejected');

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, targetWorkflowId));
    expect(row.label).toBe('Reject target');
  });
});
