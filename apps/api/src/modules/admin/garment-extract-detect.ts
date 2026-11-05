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

// quick_tryon shares this shape but its lone input is the shopper's photo, so `input`
// picks which titled node wins when a template also carries an unused sibling LoadImage.
export function detectGarmentExtractMappings(
  json: Record<string, unknown>,
  input: 'garment' | 'person' = 'garment',
): {
  detected: DetectedGarmentExtractMappings;
  allImageNodes: ParsedNode[];
} {
  const { detected: tryon, allImageNodes } = detectTryonMappings(json);
  const only = allImageNodes.length === 1 ? allImageNodes[0]?.id : undefined;
  return {
    detected: {
      inputNodeId: (input === 'person' ? tryon.personNodeId : tryon.garmentNodeId) ?? only,
      outputNodeId: tryon.outputNodeId,
    },
    allImageNodes,
  };
}
