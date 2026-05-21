import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../../../templates/virtual-tryon-v1.json');

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
  upperGarmentFile: string; // node 1314 — user garment
  faceFile: string;         // node 1302 — model face
  poseFile: string;         // node 1313 — pose reference image
  backgroundFile: string;   // node 1310 — background
}

/**
 * Deep-clones the workflow template and patches the four LoadImage nodes
 * with filenames previously uploaded to ComfyUI via /upload/image.
 * Returns the object suitable for the `prompt` field in POST /prompt.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const workflow = JSON.parse(JSON.stringify(loadTemplate())) as Workflow;

  workflow['1314']!.inputs['image'] = inputs.upperGarmentFile;
  workflow['1302']!.inputs['image'] = inputs.faceFile;
  workflow['1313']!.inputs['image'] = inputs.poseFile;
  workflow['1310']!.inputs['image'] = inputs.backgroundFile;

  return workflow as unknown as Record<string, unknown>;
}
