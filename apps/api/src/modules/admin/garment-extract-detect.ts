// garment_extract workflow node auto-detection. The workflow takes ONE garment
// image and returns ONE ghost-mannequin image, so unlike detectTryonMappings there
// is no person role: a lone LoadImage is the garment (tryon-detect would call it
// "person" via its fallback).
import { detectTryonMappings } from './tryon-detect.js';
import type { ParsedNode } from './workflow-detect.js';

export interface DetectedGarmentExtractMappings {
  inputNodeId?: string;
  outputNodeId?: string;
}

export function detectGarmentExtractMappings(json: Record<string, unknown>): {
  detected: DetectedGarmentExtractMappings;
  allImageNodes: ParsedNode[];
} {
  const { detected: tryon, allImageNodes } = detectTryonMappings(json);
  const only = allImageNodes.length === 1 ? allImageNodes[0]?.id : undefined;
  return {
    detected: {
      inputNodeId: tryon.garmentNodeId ?? only,
      outputNodeId: tryon.outputNodeId,
    },
    allImageNodes,
  };
}
