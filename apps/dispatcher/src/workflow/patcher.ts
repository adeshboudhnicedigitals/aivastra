import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Navigate from this file up to repo root, then into templates/
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../../../templates/virtual-tryon-v1.json');

let _template: unknown | null = null;

function loadTemplate(): unknown {
  if (_template) return _template;
  const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
  _template = JSON.parse(raw);
  return _template;
}

export interface WorkflowInputs {
  upperGarmentUrl: string;
  modelUrl: string;
  poseUrl: string;
  backgroundUrl: string;
  lowerGarmentUrl?: string;  // optional — only present when pose.showsLower=true
  outputPrefix: string;
}

/**
 * Returns a deep-cloned workflow prompt with all placeholder URLs replaced.
 * The returned object is the `prompt` field suitable for POST /prompt body.
 */
export function patchWorkflow(inputs: WorkflowInputs): Record<string, unknown> {
  const tpl = loadTemplate() as { prompt: Record<string, unknown> };
  // Deep clone to avoid mutating the cached template
  const patched = JSON.parse(JSON.stringify(tpl.prompt)) as Record<string, unknown>;

  const replacements: Record<string, string> = {
    '__AIVASTRA_UPPER_GARMENT_URL__': inputs.upperGarmentUrl,
    '__AIVASTRA_MODEL_URL__': inputs.modelUrl,
    '__AIVASTRA_POSE_URL__': inputs.poseUrl,
    '__AIVASTRA_BACKGROUND_URL__': inputs.backgroundUrl,
    '__AIVASTRA_OUTPUT_PREFIX__': inputs.outputPrefix,
    ...(inputs.lowerGarmentUrl ? { '__AIVASTRA_LOWER_GARMENT_URL__': inputs.lowerGarmentUrl } : {}),
  };

  function walk(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return replacements[obj] ?? obj;
    }
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) result[k] = walk(v);
      return result;
    }
    return obj;
  }

  return walk(patched) as Record<string, unknown>;
}
