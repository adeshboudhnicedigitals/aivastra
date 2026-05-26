import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../../../templates');

type WorkflowNode = { inputs: Record<string, unknown>; class_type: string; _meta?: unknown };
type Workflow = Record<string, WorkflowNode>;

export type WorkflowTemplate = 'twopiece' | 'onepiece' | 'hijab';

interface TemplateConfig {
  file: string;
  nodes: {
    face: string;
    pose: string;
    bg: string;
    upper: string[];
    lower: string | null;
    facePhasePromptNode: string;
    garmentPhasePromptNode: string;
  };
}

const TEMPLATE_CONFIG: Record<WorkflowTemplate, TemplateConfig> = {
  twopiece: {
    file: 'virtual-tryon-v2.json',
    nodes: {
      face: '1332',
      pose: '1333',
      bg: '1334',
      upper: ['1340', '1352'],
      lower: '1331',
      facePhasePromptNode: '1345:111',
      garmentPhasePromptNode: '1341:1199',
    },
  },
  onepiece: {
    file: 'onepiece.json',
    nodes: {
      face: '1302',
      pose: '1313',
      bg: '1310',
      upper: ['1314'],
      lower: '1323',
      facePhasePromptNode: '1308:111',
      garmentPhasePromptNode: '1315:1199',
    },
  },
  hijab: {
    file: 'hijab.json',
    nodes: {
      face: '1392',
      pose: '1379',
      bg: '1391',
      upper: ['1382'],
      lower: null,
      facePhasePromptNode: '1383:111',
      garmentPhasePromptNode: '1381:1199',
    },
  },
};

// Cache loaded templates in memory
const templateCache = new Map<string, Workflow>();

function loadTemplate(file: string): Workflow {
  if (templateCache.has(file)) return templateCache.get(file)!;
  try {
    const raw = JSON.parse(readFileSync(resolve(TEMPLATES_DIR, file), 'utf-8')) as Workflow;
    templateCache.set(file, raw);
    return raw;
  } catch (e) {
    throw new Error(`Failed to load workflow template "${file}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface WorkflowInputs {
  workflowTemplate: WorkflowTemplate;
  upperGarmentFile: string;
  /** Side/tilt face image — patched into the face LoadImage node for ComfyUI */
  faceSideFile: string;
  poseFile: string;
  backgroundFile: string;
  lowerGarmentFile?: string;
  /** If provided, overwrites the template default */
  promptFacePhase?: string;
  /** If provided, overwrites the template default */
  promptGarmentPhase?: string;
}

/**
 * Deep-clones the selected workflow template and patches LoadImage nodes
 * with filenames previously uploaded to ComfyUI via /upload/image.
 * Also patches positive prompt nodes if overrides are provided.
 * Returns the object suitable for the `prompt` field in POST /prompt.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const cfg = TEMPLATE_CONFIG[inputs.workflowTemplate];
  const template = loadTemplate(cfg.file);
  const workflow = JSON.parse(JSON.stringify(template)) as Workflow;
  const n = cfg.nodes;

  // Patch image nodes
  workflow[n.face]!.inputs['image'] = inputs.faceSideFile;
  workflow[n.pose]!.inputs['image'] = inputs.poseFile;
  workflow[n.bg]!.inputs['image'] = inputs.backgroundFile;
  for (const nodeId of n.upper) {
    if (workflow[nodeId]) workflow[nodeId]!.inputs['image'] = inputs.upperGarmentFile;
  }
  if (n.lower && inputs.lowerGarmentFile && workflow[n.lower]) {
    workflow[n.lower]!.inputs['image'] = inputs.lowerGarmentFile;
  }

  // Patch positive prompts if overridden
  if (inputs.promptFacePhase !== undefined && workflow[n.facePhasePromptNode]) {
    workflow[n.facePhasePromptNode]!.inputs['prompt'] = inputs.promptFacePhase;
  }
  if (inputs.promptGarmentPhase !== undefined && workflow[n.garmentPhasePromptNode]) {
    workflow[n.garmentPhasePromptNode]!.inputs['prompt'] = inputs.promptGarmentPhase;
  }

  return workflow as unknown as Record<string, unknown>;
}
