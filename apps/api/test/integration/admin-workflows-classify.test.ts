import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// WhatsApp garment recognition workflow type (spec 8a, plan 5 Task 2): the
// three node ids are detected by class_type at upload and stored in the
// columns the regeneration type already reuses.
describe('admin workflows - classify (garment recognition)', () => {
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

  let n = 0;
  const slug = (p: string) => `${p}_${Date.now()}_${n++}`;

  const qwenPrompt = (withPlaceholder: boolean) =>
    `You are a strict garment classification system.\nChoose exactly ONE option below and reply with its key only.\n\n${withPlaceholder ? '{{OPTIONS}}' : 'kurti — Kurti'}\n\nReply with one key only.`;

  const classifyJson = (outputClassType = 'PreviewAny', prompt = qwenPrompt(true)) => ({
    '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
    '2': {
      class_type: 'ImageScaleToTotalPixels',
      inputs: { image: ['1', 0], megapixels: 1 },
    },
    '3': {
      class_type: 'AILab_QwenVL',
      inputs: { image: ['2', 0], model_name: 'Qwen2.5-VL-7B-Instruct', custom_prompt: prompt },
    },
    '4': { class_type: outputClassType, inputs: { source: ['3', 0] } },
  });

  const postClassify = (jsonContent: Record<string, unknown>, s?: string) =>
    app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: s ?? slug('classify'),
        label: 'Garment classify test',
        jsonContent,
        workflowType: 'classify',
      },
    });

  it('creates a valid classify workflow with detected node ids', async () => {
    const response = await postClassify(classifyJson());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.workflowType).toBe('classify');
    expect(body.tryonPersonNodeId).toBe('1');
    expect(body.garmentPhasePromptNode).toBe('3');
    expect(body.tryonOutputNodeId).toBe('4');
    expect(body.defaultGarmentPhasePrompt).toContain('{{OPTIONS}}');
  });

  it('accepts ShowText|pysssss as the output node', async () => {
    const response = await postClassify(classifyJson('ShowText|pysssss'));
    expect(response.statusCode).toBe(200);
    expect(response.json().tryonOutputNodeId).toBe('4');
  });

  it('rejects malformed classify workflows with a message naming the problem', async () => {
    // No AILab_QwenVL node.
    const { '3': _qwen, ...noQwen } = classifyJson();
    const noQwenRes = await postClassify(noQwen);
    expect(noQwenRes.statusCode).toBe(400);
    expect(noQwenRes.json().error.message).toMatch(/Qwen/i);

    // Two LoadImage nodes.
    const twoImages = {
      ...classifyJson(),
      '5': { class_type: 'LoadImage', inputs: { image: 'other.png' } },
    };
    const twoImagesRes = await postClassify(twoImages);
    expect(twoImagesRes.statusCode).toBe(400);
    expect(twoImagesRes.json().error.message).toMatch(/image input/i);

    // No text output node.
    const { '4': _out, ...noOutput } = classifyJson();
    const noOutputRes = await postClassify(noOutput);
    expect(noOutputRes.statusCode).toBe(400);
    expect(noOutputRes.json().error.message).toMatch(/text output/i);

    // Qwen prompt without the {{OPTIONS}} placeholder.
    const noPlaceholderRes = await postClassify(classifyJson('PreviewAny', qwenPrompt(false)));
    expect(noPlaceholderRes.statusCode).toBe(400);
    expect(noPlaceholderRes.json().error.message).toMatch(/\{\{OPTIONS\}\}/);
  });

  it('keeps a single active classify workflow, demoting in both directions', async () => {
    const first = await postClassify(classifyJson());
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id as string;

    const second = await postClassify(classifyJson());
    expect(second.statusCode).toBe(200);
    const secondId = second.json().id as string;

    const [firstRow] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, firstId));
    expect(firstRow.isActive).toBe(false);

    // Reactivating the first demotes the second.
    const reactivate = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${firstId}`,
      headers,
      payload: { isActive: true },
    });
    expect(reactivate.statusCode).toBe(200);

    const [secondRow] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, secondId));
    expect(secondRow.isActive).toBe(false);
  });
});
