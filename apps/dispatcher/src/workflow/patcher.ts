import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../../../templates/virtual-tryon-v2.json');

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

let _template: Workflow | null = null;

function loadTemplate(): Workflow {
  if (_template) return _template;
  _template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8')) as Workflow;
  return _template;
}

export interface WorkflowInputs {
  // ComfyUI filenames returned by /upload/image
  upperGarmentFile: string;  // node 1340 — user upper garment
  faceFile: string;          // node 1332 — model face
  poseFile: string;          // node 1333 — pose reference image
  backgroundFile: string;    // node 1334 — background
  lowerGarmentFile?: string; // node 1331 — lower garment (optional)
}

/**
 * Deep-clones the workflow template and patches the LoadImage nodes
 * with filenames previously uploaded to ComfyUI via /upload/image.
 * Returns the object suitable for the `prompt` field in POST /prompt.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const workflow = JSON.parse(JSON.stringify(loadTemplate())) as Workflow;

  workflow['1340']!.inputs['image'] = inputs.upperGarmentFile;
  // node 1352 is a second upper-garment reference used in the twopiece layout panel (v2 template)
  if (workflow['1352']) workflow['1352']!.inputs['image'] = inputs.upperGarmentFile;
  workflow['1332']!.inputs['image'] = inputs.faceFile;
  workflow['1333']!.inputs['image'] = inputs.poseFile;
  workflow['1334']!.inputs['image'] = inputs.backgroundFile;
  if (inputs.lowerGarmentFile) {
    workflow['1331']!.inputs['image'] = inputs.lowerGarmentFile;
  }

  return workflow as unknown as Record<string, unknown>;
}
