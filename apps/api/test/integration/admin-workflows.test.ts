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

  it('PATCH updates garmentPhasePrompt text in both jsonContent and defaultGarmentPhasePrompt', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_garment_${Date.now()}`,
        label: 'Prompt edit garment',
        jsonContent,
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
      payload: { garmentPhasePrompt: 'a brand new positive prompt' },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({
        jsonContent: schema.workflowTemplates.jsonContent,
        defaultGarmentPhasePrompt: schema.workflowTemplates.defaultGarmentPhasePrompt,
      })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.defaultGarmentPhasePrompt).toBe('a brand new positive prompt');
    const stored = row?.jsonContent as Record<string, { inputs: { prompt?: string } }>;
    expect(stored.positive_node.inputs.prompt).toBe('a brand new positive prompt');
  });

  it('PATCH rejects an empty or whitespace-only garmentPhasePrompt', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_empty_${Date.now()}`,
        label: 'Prompt edit empty',
        jsonContent,
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
      payload: { garmentPhasePrompt: '   ' },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('PATCH updates facePhasePrompt when the workflow has a facePhasePromptNode', async () => {
    const withFace = {
      ...jsonContent,
      face_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
      negative_node: {
        inputs: { prompt: 'default negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_face_${Date.now()}`,
        label: 'Prompt edit face',
        jsonContent: withFace,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
        faceNodeId: 'face_node',
        facePhasePromptNode: 'negative_node',
      },
    });
    const id = createRes.json().id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { facePhasePrompt: 'a brand new negative prompt' },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({
        jsonContent: schema.workflowTemplates.jsonContent,
        defaultFacePhasePrompt: schema.workflowTemplates.defaultFacePhasePrompt,
      })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.defaultFacePhasePrompt).toBe('a brand new negative prompt');
    const stored = row?.jsonContent as Record<string, { inputs: { prompt?: string } }>;
    expect(stored.negative_node.inputs.prompt).toBe('a brand new negative prompt');
  });

  it('PATCH rejects facePhasePrompt when the workflow has no facePhasePromptNode', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_no_face_${Date.now()}`,
        label: 'Prompt edit no face',
        jsonContent,
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
      payload: { facePhasePrompt: 'should be rejected' },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('PATCH allows an empty facePhasePrompt when a facePhasePromptNode exists', async () => {
    const withFace = {
      ...jsonContent,
      face_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
      negative_node: {
        inputs: { prompt: 'default negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_face_empty_${Date.now()}`,
        label: 'Prompt edit face empty',
        jsonContent: withFace,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
        faceNodeId: 'face_node',
        facePhasePromptNode: 'negative_node',
      },
    });
    const id = createRes.json().id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: { facePhasePrompt: '' },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ defaultFacePhasePrompt: schema.workflowTemplates.defaultFacePhasePrompt })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.defaultFacePhasePrompt).toBe('');
  });

  it('PATCH writes to the "text" key for a node that already uses "text" instead of "prompt"', async () => {
    const textKeyed = {
      ...jsonContent,
      positive_node: {
        inputs: { text: 'default via text key' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'positive_prompt' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `prompt_edit_textkey_${Date.now()}`,
        label: 'Prompt edit text key',
        jsonContent: textKeyed,
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
      payload: { garmentPhasePrompt: 'updated via text key' },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ jsonContent: schema.workflowTemplates.jsonContent })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    const stored = row?.jsonContent as Record<
      string,
      { inputs: { text?: string; prompt?: string } }
    >;
    expect(stored.positive_node.inputs.text).toBe('updated via text key');
    expect(stored.positive_node.inputs.prompt).toBeUndefined();
  });

  it('GET /admin/workflows list response includes facePhasePromptNode', async () => {
    const withFace = {
      ...jsonContent,
      face_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'face' } },
      negative_node: {
        inputs: { prompt: 'default negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `list_face_node_${Date.now()}`,
        label: 'List face node',
        jsonContent: withFace,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
        faceNodeId: 'face_node',
        facePhasePromptNode: 'negative_node',
      },
    });
    const id = createRes.json().id as string;

    const listRes = await app.inject({ method: 'GET', url: '/admin/workflows', headers });
    expect(listRes.statusCode).toBe(200);
    const row = (listRes.json() as { id: string; facePhasePromptNode: string | null }[]).find(
      (w) => w.id === id,
    );
    expect(row?.facePhasePromptNode).toBe('negative_node');
  });
});
