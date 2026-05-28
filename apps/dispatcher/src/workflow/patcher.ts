import { eq } from 'drizzle-orm';
import { schema, type DB } from '@aivastra/db';

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

// ── TTL cache ─────────────────────────────────────────────────────────────
// Caches the full workflow record from the DB to avoid a round-trip per job.
// Entries expire after 5 minutes — so updated node mappings take effect within
// one cache window without requiring a dispatcher restart.

interface CacheEntry {
  record: typeof schema.workflowTemplates.$inferSelect;
  expiresAt: number;
}

const workflowCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  workflowCache.set(workflowTemplateId, {
    record,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return record;
}

/** Force-evict a workflow from the cache (e.g. after admin update). Not required — TTL handles it. */
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

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1':  { width: 1536, height: 1536 },
  '3:4':  { width: 1331, height: 1774 },
  '4:5':  { width: 1375, height: 1718 },
  '9:16': { width: 1152, height: 2048 },
  '16:9': { width: 2048, height: 1152 },
};

// ── Public interface ──────────────────────────────────────────────────────

export interface WorkflowInputs {
  workflowTemplateId: string; // UUID from workflow_templates.id
  upperGarmentFile: string;
  /** Side/tilt face image — patched into the face LoadImage node for ComfyUI */
  faceSideFile: string;
  /** Front-facing display face — patched into faceFrontNodeId if the workflow has one */
  faceFrontFile?: string;
  poseFile: string;
  backgroundFile: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  /** If provided, overwrites the template default */
  promptFacePhase?: string;
  /** If provided, overwrites the template default */
  promptGarmentPhase?: string;
  /** e.g. "4:5" — patches width/height on sizeNodeId if workflow has one */
  aspectRatio?: string;
}

type PatchLog = { warn: (msg: string, ...args: unknown[]) => void };

/**
 * Loads the workflow template from the database (with 5-minute TTL cache),
 * deep-clones the JSON, patches LoadImage nodes with ComfyUI filenames,
 * and optionally patches positive prompt nodes.
 * Returns the object suitable for the `prompt` field in POST /prompt.
 */
export async function patchWorkflow(
  inputs: WorkflowInputs,
  db: DB,
  log?: PatchLog,
): Promise<Record<string, unknown>> {
  const tmpl = await loadWorkflow(db, inputs.workflowTemplateId);
  const workflow = JSON.parse(JSON.stringify(tmpl.jsonContent)) as Workflow;

  // Patch required image nodes
  requireNode(workflow, tmpl.faceNodeId, 'face').inputs['image'] = inputs.faceSideFile;

  // Patch optional front-face node if workflow has one configured
  if (tmpl.faceFrontNodeId && inputs.faceFrontFile) {
    if (workflow[tmpl.faceFrontNodeId]) {
      workflow[tmpl.faceFrontNodeId]!.inputs['image'] = inputs.faceFrontFile;
    }
  }
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs['image'] = inputs.poseFile;
  requireNode(workflow, tmpl.bgNodeId, 'bg').inputs['image'] = inputs.backgroundFile;

  // Patch upper garment into all configured upper nodes
  for (const uid of tmpl.upperNodeIds) {
    if (workflow[uid]) {
      workflow[uid]!.inputs['image'] = inputs.upperGarmentFile;
    }
  }

  // Patch lower garment if configured
  if (tmpl.lowerNodeId && inputs.lowerGarmentFile) {
    if (workflow[tmpl.lowerNodeId]) {
      workflow[tmpl.lowerNodeId]!.inputs['image'] = inputs.lowerGarmentFile;
    }
  } else if (!tmpl.lowerNodeId && inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  // Patch shoe garment if configured
  if (tmpl.shoeNodeId && inputs.shoeGarmentFile) {
    if (workflow[tmpl.shoeNodeId]) {
      workflow[tmpl.shoeNodeId]!.inputs['image'] = inputs.shoeGarmentFile;
    }
  } else if (!tmpl.shoeNodeId && inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }

  // Patch positive prompts only when the pose provides a non-empty override.
  // Guard is truthy (not !== undefined) so empty strings from legacy poses are skipped
  // and the workflow template's default prompt text is preserved in ComfyUI.
  if (inputs.promptFacePhase && workflow[tmpl.facePhasePromptNode]) {
    workflow[tmpl.facePhasePromptNode]!.inputs['prompt'] = inputs.promptFacePhase;
  }
  if (inputs.promptGarmentPhase && workflow[tmpl.garmentPhasePromptNode]) {
    workflow[tmpl.garmentPhasePromptNode]!.inputs['prompt'] = inputs.promptGarmentPhase;
  }

  // Patch EmptyLatentImage dimensions for selected aspect ratio
  if (tmpl.sizeNodeId && inputs.aspectRatio) {
    const dims = ASPECT_DIMENSIONS[inputs.aspectRatio];
    if (dims && workflow[tmpl.sizeNodeId]) {
      workflow[tmpl.sizeNodeId]!.inputs['width'] = dims.width;
      workflow[tmpl.sizeNodeId]!.inputs['height'] = dims.height;
    } else if (!dims) {
      log?.warn(`patchWorkflow: unknown aspectRatio "${inputs.aspectRatio}" — skipping size patch`);
    }
  }

  return workflow as unknown as Record<string, unknown>;
}
