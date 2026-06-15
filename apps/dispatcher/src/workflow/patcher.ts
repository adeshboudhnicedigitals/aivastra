import { type DB, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

// ── TTL cache ─────────────────────────────────────────────────────────────

interface CacheEntry {
  record: typeof schema.workflowTemplates.$inferSelect;
  expiresAt: number;
}

const workflowCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadWorkflow(
  db: DB,
  workflowTemplateId: string,
): Promise<typeof schema.workflowTemplates.$inferSelect> {
  const cached = workflowCache.get(workflowTemplateId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.record;
  }

  const [record] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));

  if (!record) {
    throw new Error(`Workflow template "${workflowTemplateId}" not found in database`);
  }

  workflowCache.set(workflowTemplateId, { record, expiresAt: Date.now() + CACHE_TTL_MS });
  return record;
}

export function evictWorkflowCache(workflowTemplateId: string): void {
  workflowCache.delete(workflowTemplateId);
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

export const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1536, height: 1536 },
  '2:3': { width: 1365, height: 2048 },
  '3:4': { width: 1331, height: 1774 },
  '4:5': { width: 1375, height: 1718 },
};

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

  // Aspect ratio — patch all size-controlling nodes based on their class_type.
  // PrimitiveInt nodes: sizeNodeIds[0] = width node, sizeNodeIds[1] = height node.
  if (inputs.aspectRatio && tmpl.sizeNodeIds.length > 0) {
    const dims = ASPECT_DIMENSIONS[inputs.aspectRatio];
    if (!dims) {
      log?.warn(`patchWorkflow: unknown aspectRatio "${inputs.aspectRatio}" — skipping size patch`);
    } else {
      for (let i = 0; i < tmpl.sizeNodeIds.length; i++) {
        const nodeId = tmpl.sizeNodeIds[i];
        if (!nodeId) continue;
        const node = workflow[nodeId];
        if (!node) continue;
        if (node.class_type === 'PrimitiveInt') {
          node.inputs.value = i === 0 ? dims.width : dims.height;
        } else if (node.class_type === 'ResizeImageMaskNode') {
          node.inputs['resize_type.width'] = dims.width;
          node.inputs['resize_type.height'] = dims.height;
        } else if (node.class_type === 'ResizeAndPadImage') {
          node.inputs.target_width = dims.width;
          node.inputs.target_height = dims.height;
        } else {
          // EmptyLatentImage and generic fallback
          node.inputs.width = dims.width;
          node.inputs.height = dims.height;
        }
      }
    }
  }

  return workflow as unknown as Record<string, unknown>;
}

/**
 * Loads the workflow template from the DB (with 5-min TTL cache), deep-clones
 * the JSON, and delegates to applyWorkflowPatch.
 */
export async function patchWorkflow(
  inputs: WorkflowInputs,
  db: DB,
  log?: PatchLog,
): Promise<Record<string, unknown>> {
  const tmpl = await loadWorkflow(db, inputs.workflowTemplateId);
  const workflow = JSON.parse(JSON.stringify(tmpl.jsonContent)) as Workflow;
  return applyWorkflowPatch(workflow, tmpl, inputs, log);
}
