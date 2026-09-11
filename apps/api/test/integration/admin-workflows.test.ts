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

  const jsonContentWithKSampler = {
    ...jsonContent,
    ksampler_node: {
      inputs: {
        seed: 12345,
        steps: 4,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
      class_type: 'KSampler',
      _meta: { title: 'KSampler' },
    },
  };

  it('PATCH updates steps/cfg/denoise via ksamplerOverrides in jsonContent', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_edit_${Date.now()}`,
        label: 'KSampler edit',
        jsonContent: jsonContentWithKSampler,
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
      payload: {
        ksamplerOverrides: [{ nodeId: 'ksampler_node', steps: 8, cfg: 2.5, denoise: 0.75 }],
      },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ jsonContent: schema.workflowTemplates.jsonContent })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    const stored = row?.jsonContent as Record<
      string,
      { inputs: { steps?: number; cfg?: number; denoise?: number } }
    >;
    expect(stored.ksampler_node.inputs.steps).toBe(8);
    expect(stored.ksampler_node.inputs.cfg).toBe(2.5);
    expect(stored.ksampler_node.inputs.denoise).toBe(0.75);
  });

  it('PATCH rejects a ksamplerOverrides steps below 1', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_steps_${Date.now()}`,
        label: 'KSampler steps invalid',
        jsonContent: jsonContentWithKSampler,
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
      payload: { ksamplerOverrides: [{ nodeId: 'ksampler_node', steps: 0 }] },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('PATCH rejects a negative ksamplerOverrides cfg', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_cfg_${Date.now()}`,
        label: 'KSampler cfg invalid',
        jsonContent: jsonContentWithKSampler,
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
      payload: { ksamplerOverrides: [{ nodeId: 'ksampler_node', cfg: -1 }] },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('PATCH rejects a ksamplerOverrides denoise outside [0, 1]', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_denoise_${Date.now()}`,
        label: 'KSampler denoise invalid',
        jsonContent: jsonContentWithKSampler,
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
      payload: { ksamplerOverrides: [{ nodeId: 'ksampler_node', denoise: 1.5 }] },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('PATCH rejects a ksamplerOverrides nodeId that does not exist in the workflow', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_missing_${Date.now()}`,
        label: 'KSampler missing node',
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
      payload: { ksamplerOverrides: [{ nodeId: 'ksampler_node', steps: 10 }] },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it('GET list and GET detail agree on ksamplerNodes for the same workflow', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_agree_${Date.now()}`,
        label: 'KSampler agreement',
        jsonContent: jsonContentWithKSampler,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const id = createRes.json().id as string;

    const listRes = await app.inject({ method: 'GET', url: '/admin/workflows', headers });
    const detailRes = await app.inject({
      method: 'GET',
      url: `/admin/workflows/${id}`,
      headers,
    });
    type KSamplerNode = {
      nodeId: string;
      steps: number | null;
      cfg: number | null;
      denoise: number | null;
      seed: number | null;
    };
    const listItem = (listRes.json() as { id: string; ksamplerNodes: KSamplerNode[] }[]).find(
      (w) => w.id === id,
    );
    const detail = detailRes.json() as { ksamplerNodes: KSamplerNode[] };
    expect(listItem?.ksamplerNodes).toEqual([
      { nodeId: 'ksampler_node', steps: 4, cfg: 1, denoise: 1, seed: 12345 },
    ]);
    expect(detail.ksamplerNodes).toEqual(listItem?.ksamplerNodes);
  });

  it('PATCH with only steps in ksamplerOverrides leaves cfg/denoise unchanged', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `ksampler_partial_${Date.now()}`,
        label: 'KSampler partial update',
        jsonContent: jsonContentWithKSampler,
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
      payload: { ksamplerOverrides: [{ nodeId: 'ksampler_node', steps: 20 }] },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ jsonContent: schema.workflowTemplates.jsonContent })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    const stored = row?.jsonContent as Record<
      string,
      { inputs: { steps?: number; cfg?: number; denoise?: number } }
    >;
    expect(stored.ksampler_node.inputs.steps).toBe(20);
    expect(stored.ksampler_node.inputs.cfg).toBe(1);
    expect(stored.ksampler_node.inputs.denoise).toBe(1);
  });

  it('POST seeds a new regeneration workflow with the 5 default regeneration reasons', async () => {
    // Only the dedicated 'regeneration' workflow type uses reason prompts —
    // see the 'does not seed default regeneration reasons onto a
    // non-regeneration workflow' test below for the 'regular' case.
    const response = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `default_reasons_${Date.now()}`,
        label: 'Default reasons',
        jsonContent: {
          person_node: {
            inputs: { image: '' },
            class_type: 'LoadImage',
            _meta: { title: 'person' },
          },
          positive_node: {
            inputs: { prompt: 'default reason prompt' },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'positive_prompt' },
          },
          negative_node: {
            inputs: { text: 'default negative' },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'negative_prompt' },
          },
          output_node: {
            inputs: {},
            class_type: 'Save Image With Callback',
            _meta: { title: 'output' },
          },
        },
        workflowType: 'regeneration',
        facePhasePromptNode: 'negative_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.regenerationReasonPrompts).toEqual([
      { reason: 'Multiple body parts', prompt: '', instruction: '' },
      { reason: 'Nudity', prompt: '', instruction: '' },
      { reason: 'Draping issue', prompt: '', instruction: '' },
      { reason: 'Additional assets', prompt: '', instruction: '' },
      { reason: 'Texture issue', prompt: '', instruction: '' },
    ]);
  });

  it('PATCH keeps blank-prompt regeneration reasons instead of dropping them', async () => {
    // regenerationReasonPrompts is only settable on a 'regeneration'-type
    // workflow — see the 'rejects regenerationReasonPrompts on a
    // non-regeneration workflow' test below for the 'regular' case.
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `keep_blank_reasons_${Date.now()}`,
        label: 'Keep blank reasons',
        jsonContent: {
          person_node: {
            inputs: { image: '' },
            class_type: 'LoadImage',
            _meta: { title: 'person' },
          },
          positive_node: {
            inputs: { prompt: 'default reason prompt' },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'positive_prompt' },
          },
          negative_node: {
            inputs: { text: 'default negative' },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'negative_prompt' },
          },
          output_node: {
            inputs: {},
            class_type: 'Save Image With Callback',
            _meta: { title: 'output' },
          },
        },
        workflowType: 'regeneration',
        facePhasePromptNode: 'negative_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    const id = createRes.json().id as string;

    // Simulates the admin edit screen: save right after opening, with the
    // default reasons still present but none of them given a prompt/
    // instruction yet.
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: {
        regenerationReasonPrompts: [
          { reason: 'Multiple body parts', prompt: '' },
          { reason: 'Nudity', prompt: '' },
          {
            reason: 'Draping issue',
            prompt: 'garment sits flat, no fabric warping',
            instruction: 'preserve the original garment silhouette',
          },
          { reason: '  ', prompt: 'should be dropped — blank reason label' },
        ],
      },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select({ regenerationReasonPrompts: schema.workflowTemplates.regenerationReasonPrompts })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.regenerationReasonPrompts).toEqual([
      { reason: 'Multiple body parts', prompt: '', instruction: '' },
      { reason: 'Nudity', prompt: '', instruction: '' },
      {
        reason: 'Draping issue',
        prompt: 'garment sits flat, no fabric warping',
        instruction: 'preserve the original garment silhouette',
      },
    ]);
  });

  it('PATCH rejects regenerationReasonPrompts on a non-regeneration workflow', async () => {
    // regenerationReasonPrompts is meaningful only on a 'regeneration'-type
    // template — a 'regular'/'tryon' template must reject it rather than
    // silently accept (and possibly re-populate) the field.
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: `reject_reasons_on_regular_${Date.now()}`,
        label: 'Regular, rejects reasons',
        jsonContent,
        workflowType: 'regular',
        poseNodeId: 'pose_node',
        lowerNodeId: 'lower_node',
        garmentPhasePromptNode: 'positive_node',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const id = createRes.json().id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${id}`,
      headers,
      payload: {
        regenerationReasonPrompts: [{ reason: 'Nudity', prompt: 'should be rejected' }],
      },
    });
    expect(patchRes.statusCode).toBe(400);

    const [row] = await app.db
      .select({ regenerationReasonPrompts: schema.workflowTemplates.regenerationReasonPrompts })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    expect(row?.regenerationReasonPrompts).toEqual([]);
  });

  describe('workflow replace with drain', () => {
    it('rejects replace with wrong admin password', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `replace_bad_pw_${Date.now()}`,
          label: 'Replace Bad PW',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(createRes.statusCode).toBe(200);
      const id = createRes.json().id as string;

      const replaceRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_bad_pw_${Date.now()}`,
          label: 'Replaced Label',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'wrongpassword',
        },
      });
      expect(replaceRes.statusCode).toBe(401);
    });

    async function seedNonTerminalJobOnTemplate(workflowTemplateId: string, version: number) {
      const [user] = await app.db
        .insert(schema.users)
        .values({
          email: `replace-drain-${Date.now()}-${Math.random()}@example.com`,
          passwordHash: null,
          tier: 'free',
        })
        .returning();
      const [job] = await app.db
        .insert(schema.jobs)
        .values({ userId: user.id, status: 'QUEUED', creditsCharged: 1 })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: job.id,
        params: { workflowTemplateId, dispatchTemplateVersion: version },
      });
      return job.id;
    }

    it('replaces a workflow with no in-flight jobs immediately, without archiving or draining', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `replace_no_jobs_${Date.now()}`,
          label: 'Initial Label',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(createRes.statusCode).toBe(200);
      const id = createRes.json().id as string;

      // No job anywhere references this brand-new template — replacing it
      // should not archive anything, since there is nothing to drain.
      const replaceRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_no_jobs_${Date.now()}`,
          label: 'Replaced Label',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(replaceRes.statusCode).toBe(200);
      const replacedBody = replaceRes.json();
      expect(replacedBody.version).toBe(2);
      expect(replacedBody.draining).toBeNull();

      const [archiveRow] = await app.db
        .select()
        .from(schema.workflowTemplateArchives)
        .where(eq(schema.workflowTemplateArchives.workflowTemplateId, id));
      expect(archiveRow).toBeUndefined();

      // A second replace must succeed right away — nothing is draining, so
      // there is no conflict to wait out.
      const replaceAgainRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_no_jobs_${Date.now()}`,
          label: 'Replaced Again',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(replaceAgainRes.statusCode).toBe(200);
      expect(replaceAgainRes.json().version).toBe(3);
      expect(replaceAgainRes.json().draining).toBeNull();
    });

    it('replaces workflow, increments version to 2, archives old version, and reports draining', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `replace_success_${Date.now()}`,
          label: 'Initial Label',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(createRes.statusCode).toBe(200);
      const id = createRes.json().id as string;

      // Check initial GET returns version 1 and draining: null
      const getInitial = await app.inject({
        method: 'GET',
        url: `/admin/workflows/${id}`,
        headers,
      });
      expect(getInitial.statusCode).toBe(200);
      expect(getInitial.json().version).toBe(1);
      expect(getInitial.json().draining).toBeNull();

      // A non-terminal job stamped with the current (v1) version is the only
      // thing that should make this replace archive anything.
      await seedNonTerminalJobOnTemplate(id, 1);

      // Replace with new label and new positive prompt
      const newJson = {
        ...jsonContent,
        positive_node: {
          inputs: { prompt: 'replaced prompt' },
          class_type: 'CLIPTextEncode',
          _meta: { title: 'positive_prompt' },
        },
      };

      const replaceRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_success_${Date.now()}`,
          label: 'Replaced Label',
          jsonContent: newJson,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(replaceRes.statusCode).toBe(200);
      const replacedBody = replaceRes.json();
      expect(replacedBody.version).toBe(2);
      expect(replacedBody.label).toBe('Replaced Label');
      expect(replacedBody.defaultGarmentPhasePrompt).toBe('replaced prompt');
      expect(replacedBody.draining).toEqual({ fromVersion: 1 });

      // Verify DB state: live row is version 2
      const [liveRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, id));
      expect(liveRow?.version).toBe(2);
      expect(liveRow?.label).toBe('Replaced Label');

      // Verify DB state: archive row holds version 1
      const [archiveRow] = await app.db
        .select()
        .from(schema.workflowTemplateArchives)
        .where(eq(schema.workflowTemplateArchives.workflowTemplateId, id));
      expect(archiveRow).toBeDefined();
      expect(archiveRow?.version).toBe(1);
      expect(archiveRow?.defaultGarmentPhasePrompt).toBe('default');

      // Check GET /admin/workflows/:id returns draining status
      const getReplaced = await app.inject({
        method: 'GET',
        url: `/admin/workflows/${id}`,
        headers,
      });
      expect(getReplaced.statusCode).toBe(200);
      expect(getReplaced.json().version).toBe(2);
      expect(getReplaced.json().draining).toEqual({ fromVersion: 1 });

      // Check GET /admin/workflows list also includes draining
      const getList = await app.inject({
        method: 'GET',
        url: '/admin/workflows',
        headers,
      });
      expect(getList.statusCode).toBe(200);
      const listItem = getList.json().find((w: { id: string }) => w.id === id);
      expect(listItem?.version).toBe(2);
      expect(listItem?.draining).toEqual({ fromVersion: 1 });

      // Attempting to replace again while draining must return 409 CONFLICT
      const replaceAgainRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_success_${Date.now()}`,
          label: 'Replaced Again',
          jsonContent: newJson,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(replaceAgainRes.statusCode).toBe(409);
      expect(replaceAgainRes.json().error.message).toContain('draining');
    });

    async function seedWorkflowTemplate(labelSuffix: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `replace_prompt_${labelSuffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          label: `Replace Prompt ${labelSuffix}`,
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json().id as string;
    }

    async function replaceWorkflow(id: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `replace_prompt_replaced_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          label: 'Replaced',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          password: 'password123',
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    it('clears a pose default prompt override when its workflow is replaced, leaving workflowTemplateId intact', async () => {
      const templateId = await seedWorkflowTemplate('pose_default');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose with default override',
          genderSlug: 'women',
          r2Key: `replace-prompt-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
          promptGarmentPhase: 'old garment phase text',
          promptFacePhase: 'old face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(1);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedPose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, pose.id));
      expect(updatedPose.promptGarmentPhase).toBeNull();
      expect(updatedPose.promptFacePhase).toBeNull();
      expect(updatedPose.workflowTemplateId).toBe(templateId);
    });

    it('clears an explicit per-garment-type prompt override when its referenced workflow is replaced', async () => {
      const templateId = await seedWorkflowTemplate('config_direct');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose for direct config override',
          genderSlug: 'women',
          r2Key: `replace-prompt-direct-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-direct-pose-thumb.jpg',
          scope: 'general',
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-direct-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Direct GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: templateId,
          promptGarmentPhase: 'old config garment phase text',
          promptFacePhase: 'old config face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(0);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(1);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBeNull();
      expect(updatedConfig.promptFacePhase).toBeNull();
      expect(updatedConfig.workflowTemplateId).toBe(templateId);
    });

    it('clears an inherited per-garment-type prompt override when the pose default it relies on is replaced', async () => {
      const templateId = await seedWorkflowTemplate('config_inherited');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose with inherited default',
          genderSlug: 'women',
          r2Key: `replace-prompt-inherited-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-inherited-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-inherited-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Inherited GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: null,
          promptGarmentPhase: 'old inherited garment phase text',
          promptFacePhase: 'old inherited face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(0);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(1);

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBeNull();
      expect(updatedConfig.promptFacePhase).toBeNull();
      expect(updatedConfig.workflowTemplateId).toBeNull();
    });

    it('leaves prompt overrides referencing a different, non-replaced template untouched', async () => {
      const targetTemplateId = await seedWorkflowTemplate('target');
      const otherTemplateId = await seedWorkflowTemplate('other');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose pointing at other template',
          genderSlug: 'women',
          r2Key: `replace-prompt-other-pose-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-other-pose-thumb.jpg',
          scope: 'general',
          workflowTemplateId: otherTemplateId,
          promptGarmentPhase: 'untouched garment phase text',
          promptFacePhase: 'untouched face phase text',
        })
        .returning();
      const [garmentType] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-other-gt-${Date.now()}-${Math.random()}`,
          label: 'Replace Prompt Other GT',
          isActive: true,
        })
        .returning();
      const [config] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: pose.id,
          subcategoryId: garmentType.id,
          workflowTemplateId: otherTemplateId,
          promptGarmentPhase: 'untouched config garment phase text',
          promptFacePhase: 'untouched config face phase text',
        })
        .returning();

      const replaced = await replaceWorkflow(targetTemplateId);
      expect(replaced.clearedPosePromptCount).toBe(0);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(0);

      const [updatedPose] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, pose.id));
      expect(updatedPose.promptGarmentPhase).toBe('untouched garment phase text');
      expect(updatedPose.promptFacePhase).toBe('untouched face phase text');

      const [updatedConfig] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, config.id));
      expect(updatedConfig.promptGarmentPhase).toBe('untouched config garment phase text');
      expect(updatedConfig.promptFacePhase).toBe('untouched config face phase text');
    });

    it('reports accurate counts and clears every affected row together in one replace', async () => {
      const templateId = await seedWorkflowTemplate('combined');
      const otherTemplateId = await seedWorkflowTemplate('combined_other');

      const [poseWithText] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Combined pose with text',
          genderSlug: 'women',
          r2Key: `replace-prompt-combined-with-text-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-combined-with-text-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
          promptGarmentPhase: 'combined pose garment text',
          promptFacePhase: 'combined pose face text',
        })
        .returning();

      const [poseNoText] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Combined pose without text',
          genderSlug: 'women',
          r2Key: `replace-prompt-combined-no-text-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-combined-no-text-thumb.jpg',
          scope: 'general',
          workflowTemplateId: templateId,
        })
        .returning();

      const [garmentTypeDirect] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-combined-direct-gt-${Date.now()}-${Math.random()}`,
          label: 'Combined Direct GT',
          isActive: true,
        })
        .returning();
      const [configDirect] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: poseWithText.id,
          subcategoryId: garmentTypeDirect.id,
          workflowTemplateId: templateId,
          promptGarmentPhase: 'combined config direct garment text',
          promptFacePhase: 'combined config direct face text',
        })
        .returning();

      const [garmentTypeInherited] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'women',
          slug: `replace-prompt-combined-inherited-gt-${Date.now()}-${Math.random()}`,
          label: 'Combined Inherited GT',
          isActive: true,
        })
        .returning();
      const [configInherited] = await app.db
        .insert(schema.poseGarmentConfigs)
        .values({
          poseAssetId: poseNoText.id,
          subcategoryId: garmentTypeInherited.id,
          workflowTemplateId: null,
          promptGarmentPhase: 'combined config inherited garment text',
          promptFacePhase: 'combined config inherited face text',
        })
        .returning();

      const [poseOther] = await app.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Combined pose on other template',
          genderSlug: 'women',
          r2Key: `replace-prompt-combined-other-${Date.now()}-${Math.random()}.jpg`,
          thumbnailKey: 'replace-prompt-combined-other-thumb.jpg',
          scope: 'general',
          workflowTemplateId: otherTemplateId,
          promptGarmentPhase: 'combined other pose text',
          promptFacePhase: 'combined other pose face text',
        })
        .returning();

      const replaced = await replaceWorkflow(templateId);
      expect(replaced.clearedPosePromptCount).toBe(1);
      expect(replaced.clearedGarmentConfigPromptCount).toBe(2);

      const [updatedPoseWithText] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, poseWithText.id));
      expect(updatedPoseWithText.promptGarmentPhase).toBeNull();
      expect(updatedPoseWithText.promptFacePhase).toBeNull();
      expect(updatedPoseWithText.workflowTemplateId).toBe(templateId);

      const [updatedPoseNoText] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, poseNoText.id));
      expect(updatedPoseNoText.workflowTemplateId).toBe(templateId);

      const [updatedConfigDirect] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, configDirect.id));
      expect(updatedConfigDirect.promptGarmentPhase).toBeNull();
      expect(updatedConfigDirect.promptFacePhase).toBeNull();
      expect(updatedConfigDirect.workflowTemplateId).toBe(templateId);

      const [updatedConfigInherited] = await app.db
        .select()
        .from(schema.poseGarmentConfigs)
        .where(eq(schema.poseGarmentConfigs.id, configInherited.id));
      expect(updatedConfigInherited.promptGarmentPhase).toBeNull();
      expect(updatedConfigInherited.promptFacePhase).toBeNull();
      expect(updatedConfigInherited.workflowTemplateId).toBeNull();

      const [updatedPoseOther] = await app.db
        .select()
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.id, poseOther.id));
      expect(updatedPoseOther.promptGarmentPhase).toBe('combined other pose text');
      expect(updatedPoseOther.promptFacePhase).toBe('combined other pose face text');
    });
  });

  describe('regeneration workflows', () => {
    const regenJson = {
      person_node: { inputs: { image: '' }, class_type: 'LoadImage', _meta: { title: 'person' } },
      positive_node: {
        inputs: { prompt: 'default reason prompt' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'positive_prompt' },
      },
      negative_node: {
        inputs: { text: 'default negative' },
        class_type: 'CLIPTextEncode',
        _meta: { title: 'negative_prompt' },
      },
      output_node: {
        inputs: {},
        class_type: 'Save Image With Callback',
        _meta: { title: 'output' },
      },
    };

    it('creates a regeneration workflow with auto-detected person/output/prompt nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_${Date.now()}`,
          label: 'Regen test',
          jsonContent: regenJson,
          workflowType: 'regeneration',
          facePhasePromptNode: 'negative_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.workflowType).toBe('regeneration');
      expect(body.tryonPersonNodeId).toBe('person_node');
      expect(body.tryonOutputNodeId).toBe('output_node');
    });

    it('rejects a regeneration workflow with no detectable source-image node', async () => {
      const { person_node: _drop, ...noPersonJson } = regenJson;
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_noperson_${Date.now()}`,
          label: 'Regen no person',
          jsonContent: noPersonJson,
          workflowType: 'regeneration',
          garmentPhasePromptNode: 'positive_node',
          facePhasePromptNode: 'negative_node',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('activating a second regeneration workflow demotes the first', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_first_${Date.now()}`,
          label: 'Regen first',
          jsonContent: regenJson,
          workflowType: 'regeneration',
          facePhasePromptNode: 'negative_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(first.statusCode).toBe(200);
      const firstId = first.json().id as string;

      const second = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_second_${Date.now()}`,
          label: 'Regen second',
          jsonContent: regenJson,
          workflowType: 'regeneration',
          facePhasePromptNode: 'negative_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(second.statusCode).toBe(200);

      const [firstRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, firstId));
      expect(firstRow.isActive).toBe(false);
    });

    it('reactivating a demoted regeneration workflow demotes whichever is currently active', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_reactivate_a_${Date.now()}`,
          label: 'Regen A',
          jsonContent: regenJson,
          workflowType: 'regeneration',
          facePhasePromptNode: 'negative_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      const firstId = first.json().id as string;
      const second = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regen_reactivate_b_${Date.now()}`,
          label: 'Regen B',
          jsonContent: regenJson,
          workflowType: 'regeneration',
          facePhasePromptNode: 'negative_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      const secondId = second.json().id as string;

      // Reactivate the first (currently inactive, demoted by creating the second).
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${firstId}`,
        headers,
        payload: { isActive: true },
      });
      expect(patchRes.statusCode).toBe(200);

      const [firstRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, firstId));
      const [secondRow] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, secondId));
      expect(firstRow.isActive).toBe(true);
      expect(secondRow.isActive).toBe(false);
    });

    it('does not seed default regeneration reasons onto a non-regeneration workflow', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `regular_no_reasons_${Date.now()}`,
          label: 'Regular, no reasons',
          jsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const [row] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, response.json().id));
      expect(row.regenerationReasonPrompts).toEqual([]);
    });
  });

  describe('SAM3 segmentation prompt node', () => {
    const samJsonContent = {
      ...jsonContent,
      sam_node: {
        inputs: { prompt: 'person' },
        class_type: 'Sam3Segmentation',
        _meta: { title: 'sam3_segmentation' },
      },
    };

    it('creates a workflow with samSegmentationPromptNode and extracts its default prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_create_${Date.now()}`,
          label: 'SAM3 create test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.samSegmentationPromptNode).toBe('sam_node');
      expect(body.defaultSamSegmentationPrompt).toBe('person');
    });

    it('creates a workflow with no samSegmentationPromptNode — defaults stay null/empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_absent_${Date.now()}`,
          label: 'SAM3 absent test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.samSegmentationPromptNode ?? null).toBeNull();
      expect(body.defaultSamSegmentationPrompt).toBe('');
    });

    it('rejects a nonexistent samSegmentationPromptNode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_bad_node_${Date.now()}`,
          label: 'SAM3 bad node test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'does_not_exist',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('GET /admin/workflows list includes samSegmentationPromptNode/defaultSamSegmentationPrompt', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_list_${Date.now()}`,
          label: 'SAM3 list test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      const id = createRes.json().id as string;

      const listRes = await app.inject({ method: 'GET', url: '/admin/workflows', headers });
      expect(listRes.statusCode).toBe(200);
      const row = (listRes.json() as { id: string }[]).find((w) => w.id === id) as {
        samSegmentationPromptNode: string | null;
        defaultSamSegmentationPrompt: string;
      };
      expect(row.samSegmentationPromptNode).toBe('sam_node');
      expect(row.defaultSamSegmentationPrompt).toBe('person');
    });

    async function createSamWorkflow(promptText = 'person') {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_patch_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
          label: 'SAM3 patch test',
          jsonContent: {
            ...jsonContent,
            sam_node: {
              inputs: { prompt: promptText },
              class_type: 'Sam3Segmentation',
              _meta: { title: 'sam3_segmentation' },
            },
          },
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
        },
      });
      return createRes.json().id as string;
    }

    it('PATCH rejects samSegmentationPrompt when no node is configured', async () => {
      const id = await createSamWorkflow();
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPrompt: 'garment' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('PATCH sets samSegmentationPromptNode alone and recomputes the default from the JSON', async () => {
      const id = await createSamWorkflow('person');
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'sam_node' },
      });
      expect(response.statusCode).toBe(200);

      const detailRes = await app.inject({ method: 'GET', url: `/admin/workflows/${id}`, headers });
      const detail = detailRes.json();
      expect(detail.samSegmentationPromptNode).toBe('sam_node');
      expect(detail.defaultSamSegmentationPrompt).toBe('person');
    });

    it('PATCH edits samSegmentationPrompt once a node is configured, writing into jsonContent', async () => {
      const id = await createSamWorkflow('person');
      await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'sam_node' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPrompt: 'garment' },
      });
      expect(response.statusCode).toBe(200);

      const detailRes = await app.inject({ method: 'GET', url: `/admin/workflows/${id}`, headers });
      const detail = detailRes.json();
      expect(detail.defaultSamSegmentationPrompt).toBe('garment');
      expect(
        (detail.jsonContent as Record<string, { inputs: { prompt: string } }>).sam_node.inputs
          .prompt,
      ).toBe('garment');
    });

    it('PATCH rejects a nonexistent samSegmentationPromptNode', async () => {
      const id = await createSamWorkflow();
      const response = await app.inject({
        method: 'PATCH',
        url: `/admin/workflows/${id}`,
        headers,
        payload: { samSegmentationPromptNode: 'does_not_exist' },
      });
      expect(response.statusCode).toBe(400);
    });

    async function seedNonTerminalJobOnSamTemplate(workflowTemplateId: string, version: number) {
      const [user] = await app.db
        .insert(schema.users)
        .values({
          email: `sam3-drain-${Date.now()}-${Math.random()}@example.com`,
          passwordHash: null,
          tier: 'free',
        })
        .returning();
      const [job] = await app.db
        .insert(schema.jobs)
        .values({ userId: user.id, status: 'QUEUED', creditsCharged: 1 })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: job.id,
        params: { workflowTemplateId, dispatchTemplateVersion: version },
      });
    }

    it('archives the SAM3 node ID and default prompt when a draining replace occurs', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: `sam3_replace_${Date.now()}`,
          label: 'SAM3 replace test',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
        },
      });
      const id = createRes.json().id as string;
      const version = createRes.json().version as number;

      await seedNonTerminalJobOnSamTemplate(id, version);

      const replaceRes = await app.inject({
        method: 'POST',
        url: `/admin/workflows/${id}/replace`,
        headers,
        payload: {
          slug: `sam3_replace_${Date.now()}`,
          label: 'SAM3 replaced',
          jsonContent: samJsonContent,
          workflowType: 'regular',
          poseNodeId: 'pose_node',
          lowerNodeId: 'lower_node',
          garmentPhasePromptNode: 'positive_node',
          samSegmentationPromptNode: 'sam_node',
          password: 'password123',
        },
      });
      expect(replaceRes.statusCode).toBe(200);
      expect(replaceRes.json().draining).not.toBeNull();

      const [archiveRow] = await app.db
        .select()
        .from(schema.workflowTemplateArchives)
        .where(eq(schema.workflowTemplateArchives.workflowTemplateId, id));
      expect(archiveRow?.samSegmentationPromptNode).toBe('sam_node');
      expect(archiveRow?.defaultSamSegmentationPrompt).toBe('person');
    });
  });
});
