import { type DB, schema } from '@aivastra/db';
import { CLASSIFY_OPTIONS_PLACEHOLDER, type GarmentRecognitionRequest } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';

export interface ClassifyTemplate {
  id: string;
  jsonContent: Record<string, unknown>;
  imageNodeId: string;
  promptNodeId: string;
  outputNodeId: string;
}

/**
 * The single active classify workflow (the admin save keeps it single, D51).
 * Node ids were found by class_type when it was uploaded and stored in the
 * columns the regeneration type also reuses.
 */
export async function loadClassifyTemplate(db: DB): Promise<ClassifyTemplate | null> {
  const t = schema.workflowTemplates;
  const [row] = await db
    .select({
      id: t.id,
      jsonContent: t.jsonContent,
      imageNodeId: t.tryonPersonNodeId,
      promptNodeId: t.garmentPhasePromptNode,
      outputNodeId: t.tryonOutputNodeId,
    })
    .from(t)
    .where(and(eq(t.workflowType, 'classify'), eq(t.isActive, true)))
    .limit(1);
  if (!row?.imageNodeId || !row.promptNodeId || !row.outputNodeId) return null;
  return {
    id: row.id,
    jsonContent: row.jsonContent as Record<string, unknown>,
    imageNodeId: row.imageNodeId,
    promptNodeId: row.promptNodeId,
    outputNodeId: row.outputNodeId,
  };
}

type Node = { inputs?: Record<string, unknown> };

/**
 * A runnable copy of the template: the uploaded garment in the image node and
 * one "<slug> — <label>" line per option in place of {{OPTIONS}}. Labels are
 * admin-written; collapsing their whitespace keeps each on its own line, so a
 * label can never read as an extra instruction to the model.
 */
export function buildClassifyPrompt(
  t: ClassifyTemplate,
  comfyFilename: string,
  options: GarmentRecognitionRequest['options'],
): Record<string, unknown> {
  // Never mutate the stored template (CLAUDE.md invariant).
  const wf = structuredClone(t.jsonContent) as Record<string, Node>;
  const image = wf[t.imageNodeId];
  const qwen = wf[t.promptNodeId];
  const prompt = qwen?.inputs?.custom_prompt;
  if (!image?.inputs || !qwen?.inputs || typeof prompt !== 'string') {
    throw new Error(`classify workflow ${t.id}: stored node ids do not match its JSON`);
  }
  image.inputs.image = comfyFilename;
  const lines = options
    .map((o) => `${o.slug} — ${o.label.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
    .join('\n');
  qwen.inputs.custom_prompt = prompt.replace(CLASSIFY_OPTIONS_PLACEHOLDER, lines);
  return wf;
}

/** PreviewAny and ShowText both put the text in outputs[<id>].text (Task 1 records the shape). */
export function readAnswer(
  outputs: Record<string, Record<string, unknown>>,
  outputNodeId: string,
): string | null {
  const text = outputs[outputNodeId]?.text;
  const value = Array.isArray(text) ? text[0] : text;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The prompt text and token budget of a built prompt, for the always-resident
 * service: the admin-edited template stays the one place the wording lives, the
 * service just runs it. Same node the ComfyUI path patches.
 */
export function promptFromWorkflow(
  built: Record<string, unknown>,
  promptNodeId: string,
): { prompt: string; maxTokens: number } {
  const inputs = (built[promptNodeId] as Node | undefined)?.inputs;
  const prompt = inputs?.custom_prompt;
  if (typeof prompt !== 'string') {
    throw new Error(`classify workflow: node ${promptNodeId} has no custom_prompt`);
  }
  const max = inputs?.max_tokens;
  return { prompt, maxTokens: typeof max === 'number' ? max : 64 };
}
