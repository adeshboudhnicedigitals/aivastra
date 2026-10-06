import type { DB, schema } from '@aivastra/db';
import { ASPECT_DIMENSIONS } from '@aivastra/types';
import { resolveWorkflowTemplateVersion } from './resolve-template-version.js';

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

// ── Template loading ──────────────────────────────────────────────────────

async function loadWorkflow(
  db: DB,
  workflowTemplateId: string,
  snapshotVersion: number | null | undefined,
): Promise<typeof schema.workflowTemplates.$inferSelect> {
  const record = await resolveWorkflowTemplateVersion(db, workflowTemplateId, snapshotVersion);

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

const isLink = (v: unknown): v is [string, number] =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';

/**
 * Removes an optional image node from the graph the way ComfyUI's own Bypass does when
 * exporting API JSON: each node that consumes the image is a pass-through (it carries a
 * `configs` link from upstream), so whatever read its output is rewired to that upstream
 * link and the node is dropped, along with the image node itself.
 *
 * Fails closed if a consumer has no `configs` link to fall back on — leaving the node in
 * would feed the template's placeholder image to the model as a real reference.
 */
function bypassOptionalImageNode(workflow: Workflow, imageNodeId: string, role: string): void {
  requireNode(workflow, imageNodeId, role);

  const consumers = Object.entries(workflow).filter(
    ([id, node]) =>
      id !== imageNodeId &&
      Object.values(node.inputs).some((v) => isLink(v) && v[0] === imageNodeId),
  );

  for (const [consumerId, consumer] of consumers) {
    const upstream = consumer.inputs.configs;
    if (!isLink(upstream)) {
      throw new Error(
        `Workflow node "${consumerId}" consumes the optional ${role} node "${imageNodeId}" but has ` +
          `no linked "configs" input to bypass to — cannot drop the ${role} when none is selected`,
      );
    }
    for (const node of Object.values(workflow)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (isLink(value) && value[0] === consumerId) node.inputs[key] = upstream;
      }
    }
    delete workflow[consumerId];
  }
  delete workflow[imageNodeId];
}

/**
 * Removes an optional image node AND everything that exists only to serve it — for
 * images (the saree blouse) whose node also feeds side branches such as a size
 * calculation chain or a PreviewImage, which `bypassOptionalImageNode` deliberately
 * refuses (it is the strict path accessories depend on).
 *
 * Direct consumers that carry a `configs` link are pass-throughs, bypassed exactly as
 * above. Every other consumer, and whatever transitively hangs off it, is deleted — but
 * only while that subgraph ends in a PreviewImage. Reaching any other terminal (a
 * SaveImage, say) means the graph was authored so the optional image is load-bearing,
 * and dropping it would submit a broken prompt, so this throws instead.
 */
function pruneOptionalImageNode(workflow: Workflow, imageNodeId: string, role: string): void {
  requireNode(workflow, imageNodeId, role);

  const readersOf = (id: string): string[] =>
    Object.entries(workflow)
      .filter(
        ([readerId, node]) =>
          readerId !== id && Object.values(node.inputs).some((v) => isLink(v) && v[0] === id),
      )
      .map(([readerId]) => readerId);

  const direct = readersOf(imageNodeId);
  const passThroughs = direct.filter((id) => isLink(workflow[id]?.inputs.configs));

  // Dependents: non-pass-through direct readers plus their transitive readers. The walk
  // never expands through a pass-through — its output is rewired below, so nothing
  // downstream of it depends on the image any more.
  const dependents = new Set<string>(direct.filter((id) => !passThroughs.includes(id)));
  const queue = [...dependents];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const reader of readersOf(current)) {
      if (passThroughs.includes(reader) || dependents.has(reader)) continue;
      dependents.add(reader);
      queue.push(reader);
    }
  }

  // The walk above is transitive, so a blouse wired into the real generation path would
  // sweep up the sampler, decoder and SaveImage with it. The only terminal a side branch
  // may legitimately end in is a preview; any other terminal means the blouse is
  // load-bearing, and deleting it would submit a broken graph.
  for (const id of dependents) {
    const node = workflow[id];
    if (readersOf(id).length === 0 && node?.class_type !== 'PreviewImage') {
      throw new Error(
        `Workflow node "${id}" (${node?.class_type}) is an output that depends on the optional ` +
          `${role} node "${imageNodeId}" — cannot drop the ${role} when none is selected`,
      );
    }
  }

  const doomed = new Set<string>([imageNodeId, ...passThroughs, ...dependents]);

  for (const passId of passThroughs) {
    const upstream = workflow[passId]?.inputs.configs as [string, number];
    if (dependents.has(upstream[0])) {
      throw new Error(
        `Workflow node "${passId}" bypasses to "${upstream[0]}", which is itself dropped with the ` +
          `optional ${role} node "${imageNodeId}"`,
      );
    }
    for (const node of Object.values(workflow)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (isLink(value) && value[0] === passId) node.inputs[key] = upstream;
      }
    }
  }
  for (const id of doomed) delete workflow[id];
}

/**
 * Prompt lines an author marks `[blouse]` only make sense when the blouse image is in the
 * graph: they are dropped when it is absent, and the marker is stripped when present.
 * Scans every string input rather than just the garment prompt node, because a pose's
 * prompt override replaces that node's text and would otherwise skip the tag handling.
 */
const OPTIONAL_LINE_TAG = /\[blouse\]/i;
function resolveOptionalLineTags(workflow: Workflow, present: boolean): void {
  for (const node of Object.values(workflow)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string' || !OPTIONAL_LINE_TAG.test(value)) continue;
      node.inputs[key] = value
        .split('\n')
        .flatMap((line) => {
          if (!OPTIONAL_LINE_TAG.test(line)) return [line];
          return present ? [line.replace(/\s*\[blouse\]\s*/gi, ' ').trim()] : [];
        })
        .join('\n');
    }
  }
}

/**
 * A template's latentMaxPx/outputMaxPx is a ceiling, not a target — it only ever
 * shrinks the resolved dims (proportionally, preserving aspect ratio), never grows
 * them. A cap below the current value is a deliberate per-template override of the
 * job's aspect-ratio default; a cap above or equal is a no-op.
 */
function capDimsToMaxPx(
  dims: { width: number; height: number },
  maxPx: number | null | undefined,
): { width: number; height: number } {
  const longEdge = Math.max(dims.width, dims.height);
  if (!maxPx || longEdge <= maxPx) return dims;
  const scale = maxPx / longEdge;
  return {
    width: Math.round(dims.width * scale),
    height: Math.round(dims.height * scale),
  };
}

// ── Aspect ratio dimensions ───────────────────────────────────────────────

export { ASPECT_DIMENSIONS };

// ── Public interface ──────────────────────────────────────────────────────

export interface WorkflowInputs {
  workflowTemplateId: string;
  poseFile: string;
  upperGarmentFile?: string;
  faceSideFile?: string;
  backgroundFile?: string;
  lowerGarmentFile?: string;
  shoeGarmentFile?: string;
  thirdGarmentFile?: string;
  /** Optional saree blouse. Absent on a template that maps fourthNodeId prunes that
   *  node's subgraph from the workflow instead of failing. */
  fourthGarmentFile?: string;
  /** Pre-stacked composite of every selected accessory image (see
   *  stackAccessoryImages) — a single file regardless of how many accessory
   *  categories were selected. */
  accessoryGarmentFile?: string;
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
  if (tmpl.faceNodeId) {
    if (!inputs.faceSideFile) {
      throw new Error(`Workflow "${tmpl.slug}" maps a face node but no face image was provided`);
    }
    requireNode(workflow, tmpl.faceNodeId, 'face').inputs.image = inputs.faceSideFile;
  }
  requireNode(workflow, tmpl.poseNodeId, 'pose').inputs.image = inputs.poseFile;
  if (tmpl.bgNodeId) {
    if (!inputs.backgroundFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a background node but no background image was provided`,
      );
    }
    requireNode(workflow, tmpl.bgNodeId, 'bg').inputs.image = inputs.backgroundFile;
  }

  // Upper garment — patch all mapped nodes
  if (tmpl.upperNodeIds.length > 0) {
    if (!inputs.upperGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps ${tmpl.upperNodeIds.length} upper garment node(s) but no upper garment image was provided`,
      );
    }
    for (const uid of tmpl.upperNodeIds) {
      requireNode(workflow, uid, 'upper garment').inputs.image = inputs.upperGarmentFile;
    }
  }

  // Every mapped role must receive its own file; never reuse another role's image.
  if (tmpl.lowerNodeId) {
    if (!inputs.lowerGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a lower garment node but no lower garment image was provided`,
      );
    }
    requireNode(workflow, tmpl.lowerNodeId, 'lower garment').inputs.image = inputs.lowerGarmentFile;
  } else if (inputs.lowerGarmentFile) {
    log?.warn(
      `patchWorkflow: lower garment provided but workflow "${tmpl.slug}" has no lower_node_id — skipping`,
    );
  }

  if (tmpl.shoeNodeId) {
    if (!inputs.shoeGarmentFile) {
      throw new Error(`Workflow "${tmpl.slug}" maps a shoe node but no shoe image was provided`);
    }
    requireNode(workflow, tmpl.shoeNodeId, 'shoes').inputs.image = inputs.shoeGarmentFile;
  } else if (inputs.shoeGarmentFile) {
    log?.warn(
      `patchWorkflow: shoe garment provided but workflow "${tmpl.slug}" has no shoe_node_id — skipping`,
    );
  }

  if (tmpl.thirdNodeId) {
    if (!inputs.thirdGarmentFile) {
      throw new Error(
        `Workflow "${tmpl.slug}" maps a third node but no third garment image was provided`,
      );
    }
    requireNode(workflow, tmpl.thirdNodeId, 'third garment').inputs.image = inputs.thirdGarmentFile;
  } else if (inputs.thirdGarmentFile) {
    log?.warn(
      `patchWorkflow: third garment provided but workflow "${tmpl.slug}" has no third_node_id — skipping`,
    );
  }

  // The fourth image (saree blouse) is never mandatory either — see the prune helper.
  if (tmpl.fourthNodeId) {
    if (inputs.fourthGarmentFile) {
      requireNode(workflow, tmpl.fourthNodeId, 'fourth garment').inputs.image =
        inputs.fourthGarmentFile;
    } else {
      pruneOptionalImageNode(workflow, tmpl.fourthNodeId, 'fourth garment');
    }
  } else if (inputs.fourthGarmentFile) {
    log?.warn(
      `patchWorkflow: fourth garment provided but workflow "${tmpl.slug}" has no fourth_node_id — skipping`,
    );
  }

  // Accessories are never mandatory, unlike lower/shoe/third above: a mapped
  // accessoryNodeId with nothing selected is bypassed out of the graph, because the
  // template ships a placeholder image that would otherwise reach the model.
  if (tmpl.accessoryNodeId) {
    if (inputs.accessoryGarmentFile) {
      requireNode(workflow, tmpl.accessoryNodeId, 'accessory').inputs.image =
        inputs.accessoryGarmentFile;
    } else {
      bypassOptionalImageNode(workflow, tmpl.accessoryNodeId, 'accessory');
    }
  } else if (inputs.accessoryGarmentFile) {
    log?.warn(
      `patchWorkflow: accessory image provided but workflow "${tmpl.slug}" has no accessory_node_id — skipping`,
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

  // After the override above, so a pose-supplied prompt gets the same [blouse] handling.
  if (tmpl.fourthNodeId) resolveOptionalLineTags(workflow, Boolean(inputs.fourthGarmentFile));

  // Resolve output dimensions: custom pixel dims take precedence over the
  // ASPECT_DIMENSIONS enum lookup. Custom dims come from the user's explicit
  // width/height selection in the studio; enum dims are the predefined values
  // for each of the four standard aspect ratios.
  const customDims =
    inputs.outputWidth && inputs.outputHeight
      ? { width: inputs.outputWidth, height: inputs.outputHeight }
      : null;
  const enumDims = inputs.aspectRatio ? (ASPECT_DIMENSIONS[inputs.aspectRatio] ?? null) : null;
  if (!customDims && enumDims) {
    // Every current job-creation path snapshots outputWidth/outputHeight before
    // enqueue, so this fallback firing means an older/unresolved job reached the
    // dispatcher — it renders at the hardcoded ASPECT_DIMENSIONS default (see
    // ASPECT_DIMENSIONS in packages/types/src/jobs.ts), silently ignoring
    // whatever longEdgePx an admin has configured for the job's resolution tier
    // (the dispatcher has no route to that live config). Logged so a mismatch
    // between expected and actual output size is traceable, not just mysterious.
    log?.warn(
      `patchWorkflow: workflow "${tmpl.slug}" job has no pre-resolved outputWidth/outputHeight — ` +
        `falling back to hardcoded ASPECT_DIMENSIONS["${inputs.aspectRatio}"], which ignores any admin-configured override`,
    );
  }
  const outputDims = customDims ?? enumDims;

  // Dual-size-group templates. Both latent group (max-width/max-height) and output
  // group (result-width/result-height) derive from the same resolved outputDims — the
  // two node groups exist for the workflow's own internal graph wiring — but each is
  // capped independently against its own template column (latentMaxPx/outputMaxPx),
  // which is why there are two distinct DB columns instead of one.
  const latentSizeNodeIds = tmpl.latentSizeNodeIds ?? [];
  const outputSizeNodeIds = tmpl.outputSizeNodeIds ?? [];
  if (outputDims && (latentSizeNodeIds.length === 2 || outputSizeNodeIds.length === 2)) {
    const latentDims = capDimsToMaxPx(outputDims, tmpl.latentMaxPx);
    const [lwId, lhId] = latentSizeNodeIds;
    const lwNode = lwId ? workflow[lwId] : undefined;
    const lhNode = lhId ? workflow[lhId] : undefined;
    if (lwNode) lwNode.inputs.value = latentDims.width;
    if (lhNode) lhNode.inputs.value = latentDims.height;

    if (outputSizeNodeIds.length === 2) {
      const outputCappedDims = capDimsToMaxPx(outputDims, tmpl.outputMaxPx);
      const [widthId, heightId] = outputSizeNodeIds;
      const wNode = widthId ? workflow[widthId] : undefined;
      const hNode = heightId ? workflow[heightId] : undefined;
      if (wNode) wNode.inputs.value = outputCappedDims.width;
      if (hNode) hNode.inputs.value = outputCappedDims.height;
    }
  } else if (outputDims && tmpl.sizeNodeIds.length > 0) {
    // Legacy single-group: patch all size-controlling nodes by class_type. Capped
    // against outputMaxPx — the only ceiling a legacy (non-dual-group) template has.
    // sizeNodeIds[0] = width node, sizeNodeIds[1] = height node.
    const legacyDims = capDimsToMaxPx(outputDims, tmpl.outputMaxPx);
    for (let i = 0; i < tmpl.sizeNodeIds.length; i++) {
      const nodeId = tmpl.sizeNodeIds[i];
      if (!nodeId) continue;
      const node = workflow[nodeId];
      if (!node) continue;
      const dimValue = i === 0 ? legacyDims.width : legacyDims.height;
      if (node.class_type === 'PrimitiveInt') {
        node.inputs.value = dimValue;
      } else if (node.class_type === 'ResizeImageMaskNode') {
        node.inputs['resize_type.width'] = legacyDims.width;
        node.inputs['resize_type.height'] = legacyDims.height;
      } else if (node.class_type === 'ResizeAndPadImage') {
        node.inputs.target_width = legacyDims.width;
        node.inputs.target_height = legacyDims.height;
      } else {
        // EmptyLatentImage and generic fallback
        node.inputs.width = legacyDims.width;
        node.inputs.height = legacyDims.height;
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
 * Loads the workflow template from the DB — the live row, or a specific
 * archived version if `snapshotVersion` no longer matches the live template's
 * current version — deep-clones the JSON, and delegates to applyWorkflowPatch.
 */
export async function patchWorkflow(
  inputs: WorkflowInputs,
  db: DB,
  log?: PatchLog,
  snapshotVersion?: number | null,
  resolvedTemplate?: typeof schema.workflowTemplates.$inferSelect,
): Promise<PatchedWorkflow> {
  // Reuse the dispatch snapshot so an edit during uploads cannot contaminate its performance key.
  const tmpl =
    resolvedTemplate ?? (await loadWorkflow(db, inputs.workflowTemplateId, snapshotVersion));
  const workflow = structuredClone(tmpl.jsonContent) as Workflow;
  const prompt = applyWorkflowPatch(workflow, tmpl, inputs, log);
  return { prompt, resultNodeId: tmpl.resultNodeId };
}
