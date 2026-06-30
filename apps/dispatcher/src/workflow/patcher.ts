import { type DB, schema } from '@aivastra/db';
import { ASPECT_DIMENSIONS } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { resizeToMax } from './resize-to-max.js';

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

// ── Template loading ──────────────────────────────────────────────────────
// No caching here — admin can edit a template's JSON/node mappings at any time,
// and a stale in-memory copy would silently keep patching jobs with old prompt
// defaults. This is one indexed SELECT per job, negligible next to GPU gen time.

async function loadWorkflow(
  db: DB,
  workflowTemplateId: string,
): Promise<typeof schema.workflowTemplates.$inferSelect> {
  const [record] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));

  if (!record) {
    throw new Error(`Workflow template "${workflowTemplateId}" not found in database`);
  }

  return record;
}

// ── Patch helpers ─────────────────────────────────────────────────────────

function requireNode(workflow: Workflow, nodeId: string, role: string): WorkflowNode {
  const node = workflow[nodeId];
  if (!node) {
    throw new Error(
      `Workflow node "${nodeId}" (${role}) not found in JSON — ` +
        `the stored workflow JSON may be out of sync with its node mappings`,
    );
  }
  return node;
}

// ── Aspect ratio dimensions ───────────────────────────────────────────────

export { ASPECT_DIMENSIONS };

// ── Public interface ──────────────────────────────────────────────────────

export interface WorkflowInputs {
  workflowTemplateId: string;
  upperGarmentFile: string;
  faceSideFile: string;
  poseFile: string;
  backgroundFile: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  promptFacePhase?: string;
  promptGarmentPhase?: string;
  aspectRatio?: string;
  /** Custom pixel dimensions from the user — when present, override the
   *  ASPECT_DIMENSIONS enum lookup so the exact requested resolution is used. */
  outputWidth?: number;
  outputHeight?: number;
}

export type WorkflowTemplate = typeof schema.workflowTemplates.$inferSelect;
type PatchLog = { warn: (msg: string, ...args: unknown[]) => void };

/**
 * Pure patch function — takes the already-loaded template record and a deep-cloned
 * workflow JSON, applies all node substitutions, and returns the patched workflow.
 * Exported for unit testing without a database dependency.
 */
export function applyWorkflowPatch(
  workflow: Workflow,
  tmpl: WorkflowTemplate,
  inputs: Omit<WorkflowInputs, 'workflowTemplateId'>,
  log?: PatchLog,
): Record<string, unknown> {
  // Required image nodes — throw if any are missing from the JSON
  requireNode(workflow, tmpl.faceNodeId, 'face').inputs.image = inputs.faceSideFile;
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs.image = inputs.poseFile;
  requireNode(workflow, tmpl.bgNodeId, 'bg').inputs.image = inputs.backgroundFile;

  // Upper garment — patch all mapped nodes
  for (const uid of tmpl.upperNodeIds) {
    const upperNode = workflow[uid];
    if (upperNode) upperNode.inputs.image = inputs.upperGarmentFile;
  }

  // Lower garment — fall back to upper garment when not provided so ComfyUI
  // never receives a stale/empty filename from the original workflow design.
  if (tmpl.lowerNodeId) {
    const lowerNode = workflow[tmpl.lowerNodeId];
    if (lowerNode) {
      const lowerFile = inputs.lowerGarmentFile ?? inputs.upperGarmentFile;
      if (!inputs.lowerGarmentFile) {
        log?.warn(
          `patchWorkflow: lowerNodeId "${tmpl.lowerNodeId}" mapped but no lower garment provided — falling back to upper garment`,
        );
      }
      lowerNode.inputs.image = lowerFile;
    }
  } else if (inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  // Shoe — same fallback pattern as lower garment
  if (tmpl.shoeNodeId) {
    const shoeNode = workflow[tmpl.shoeNodeId];
    if (shoeNode) {
      const shoeFile = inputs.shoeGarmentFile ?? inputs.upperGarmentFile;
      if (!inputs.shoeGarmentFile) {
        log?.warn(
          `patchWorkflow: shoeNodeId "${tmpl.shoeNodeId}" mapped but no shoe garment provided — falling back to upper garment`,
        );
      }
      shoeNode.inputs.image = shoeFile;
    }
  } else if (inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }

  // Positive prompt — only override when pose provides a non-empty, non-whitespace string.
  // Empty or whitespace-only strings are skipped so the workflow's hardcoded default is preserved.
  // Whitespace-only prompts would cause ComfyUI to reject the submission (same as empty string).
  const promptNode = workflow[tmpl.garmentPhasePromptNode];
  if (inputs.promptGarmentPhase?.trim() && promptNode) {
    promptNode.inputs.prompt = inputs.promptGarmentPhase;
  }
  // Negative prompt (facePhasePromptNode) is never overridden — hardcoded per workflow.

  // Resolve output dimensions: custom pixel dims take precedence over the
  // ASPECT_DIMENSIONS enum lookup. Custom dims come from the user's explicit
  // width/height selection in the studio; enum dims are the predefined values
  // for each of the four standard aspect ratios.
  const customDims =
    inputs.outputWidth && inputs.outputHeight
      ? { width: inputs.outputWidth, height: inputs.outputHeight }
      : null;
  const enumDims = inputs.aspectRatio ? (ASPECT_DIMENSIONS[inputs.aspectRatio] ?? null) : null;
  const outputDims = customDims ?? enumDims;

  // Dual-size-group templates. Latent group (max-width/max-height) is derived from the
  // raw aspect numbers via resizeToMax, capped at latentMaxPx — this is the diffusion
  // canvas size and doesn't need to match any fixed enum value. Output group (result-width/
  // result-height) uses the resolved outputDims directly.
  const latentSizeNodeIds = tmpl.latentSizeNodeIds ?? [];
  const outputSizeNodeIds = tmpl.outputSizeNodeIds ?? [];
  if (outputDims && (latentSizeNodeIds.length === 2 || outputSizeNodeIds.length === 2)) {
    // Latent: scale so the long edge = latentMaxPx, preserving aspect
    const latentMax = tmpl.latentMaxPx ?? 2048;
    const latentDims = resizeToMax(outputDims.width, outputDims.height, latentMax);
    const [lwId, lhId] = latentSizeNodeIds;
    const lwNode = lwId ? workflow[lwId] : undefined;
    const lhNode = lhId ? workflow[lhId] : undefined;
    if (lwNode) lwNode.inputs.value = latentDims.width;
    if (lhNode) lhNode.inputs.value = latentDims.height;

    if (outputSizeNodeIds.length === 2) {
      const [widthId, heightId] = outputSizeNodeIds;
      const wNode = widthId ? workflow[widthId] : undefined;
      const hNode = heightId ? workflow[heightId] : undefined;
      if (wNode) wNode.inputs.value = outputDims.width;
      if (hNode) hNode.inputs.value = outputDims.height;
    }
  } else if (outputDims && tmpl.sizeNodeIds.length > 0) {
    // Legacy single-group: patch all size-controlling nodes by class_type.
    // sizeNodeIds[0] = width node, sizeNodeIds[1] = height node.
    for (let i = 0; i < tmpl.sizeNodeIds.length; i++) {
      const nodeId = tmpl.sizeNodeIds[i];
      if (!nodeId) continue;
      const node = workflow[nodeId];
      if (!node) continue;
      const dimValue = i === 0 ? outputDims.width : outputDims.height;
      if (node.class_type === 'PrimitiveInt') {
        node.inputs.value = dimValue;
      } else if (node.class_type === 'ResizeImageMaskNode') {
        node.inputs['resize_type.width'] = outputDims.width;
        node.inputs['resize_type.height'] = outputDims.height;
      } else if (node.class_type === 'ResizeAndPadImage') {
        node.inputs.target_width = outputDims.width;
        node.inputs.target_height = outputDims.height;
      } else {
        // EmptyLatentImage and generic fallback
        node.inputs.width = outputDims.width;
        node.inputs.height = outputDims.height;
      }
    }
  } else if (inputs.aspectRatio) {
    log?.warn(
      `patchWorkflow: no dimensions resolved for aspectRatio "${inputs.aspectRatio}" — skipping size patch`,
    );
  }

  return workflow as unknown as Record<string, unknown>;
}

export interface PatchedWorkflow {
  prompt: Record<string, unknown>;
  resultNodeId: string | null;
}

/**
 * Loads the workflow template from the DB (with 5-min TTL cache), deep-clones
 * the JSON, and delegates to applyWorkflowPatch.
 */
export async function patchWorkflow(
  inputs: WorkflowInputs,
  db: DB,
  log?: PatchLog,
): Promise<PatchedWorkflow> {
  const tmpl = await loadWorkflow(db, inputs.workflowTemplateId);
  const workflow = JSON.parse(JSON.stringify(tmpl.jsonContent)) as Workflow;
  const prompt = applyWorkflowPatch(workflow, tmpl, inputs, log);
  return { prompt, resultNodeId: tmpl.resultNodeId };
}
