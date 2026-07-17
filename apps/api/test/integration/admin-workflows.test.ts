import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin workflows - floor validation', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
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

  it('creates a lower-only regular workflow with no face/background/upper node', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `lower_only_${Date.now()}`,
        label: 'Lower only',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.faceNodeId ?? null).toBeNull();
    expect(body.upperNodeIds).toEqual([]);
    expect(body.defaultFacePhasePrompt).toBe('');
  });

  it('rejects a regular workflow with neither upperNodeIds nor lowerNodeId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `no_garment_role_${Date.now()}`,
        label: 'No garment role',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects faceNodeId set without facePhasePromptNode', async () => {
    const withFace = {
      ...jsonContent,
      face_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `face_no_prompt_${Date.now()}`,
        label: 'Face no prompt',
        jsonContent: withFace,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
        faceNodeId: 'face_node',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('PATCH rejects clearing the last garment role, and allows converting to lower-only', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `patch_target_${Date.now()}`,
        label: 'Patch target',
        jsonContent: {
          ...jsonContent,
          upper_node: {
            inputs: { image: '' },
            class_type: 'LoadImage',
            _meta: { title: 'upper' },
          },
        },
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        upperNodeIds: ['upper_node'],
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const id = createRes.json().id as string;

    // Clearing the only garment role outright must be rejected.
    const rejectRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { upperNodeIds: [] },
    });
    expect(rejectRes.statusCode).toBe(400);

    // Setting lowerNodeId while clearing upperNodeIds in the same request must succeed.
    const convertRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { upperNodeIds: [], lowerNodeId: 'lower_node' },
    });
    expect(convertRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({
        upperNodeIds: schema.workflowTemplates.upperNodeIds,
        lowerNodeId: schema.workflowTemplates.lowerNodeId,
      })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.upperNodeIds).toEqual([]);
    expect(row?.lowerNodeId).toBe('lower_node');
  });

  it('creates a regular workflow with thirdNodeId and returns it', async () => {
    const withThird = {
      ...jsonContent,
      third_node: {
        inputs: { image: '' },
        class_type: 'LoadImage',
        _meta: { title: 'third_garment' },
      },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `third_node_create_${Date.now()}`,
        label: 'Third node create',
        jsonContent: withThird,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        thirdNodeId: 'third_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(200);

    const [row] = await app.db
      .select({ thirdNodeId: schema.workflowTemplates.thirdNodeId })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, response.json().id));
    expect(row?.thirdNodeId).toBe('third_node');
  });

  it('PATCH persists thirdNodeId', async () => {
    const withThird = {
      ...jsonContent,
      third_node: {
        inputs: { image: '' },
        class_type: 'LoadImage',
        _meta: { title: 'third_garment' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `third_node_patch_${Date.now()}`,
        label: 'Third node patch target',
        jsonContent: withThird,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const id = createRes.json().id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { thirdNodeId: 'third_node' },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ thirdNodeId: schema.workflowTemplates.thirdNodeId })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.thirdNodeId).toBe('third_node');
  });
});
