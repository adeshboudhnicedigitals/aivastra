// Fabric-to-Garment workflow node auto-detection — a separate, minimal
// detector for the 'fabric_to_garment' workflowType. Shape: one LoadImage in
// (the uploaded fabric photo), one SaveImage out, and — unlike
// background_removal/mannequin/shadow — a positive/negative prompt pair we
// DO inject at dispatch time (the admin-curated garment-type preset's prompt
// goes into the positive node; see fabric_garment_types).
//
// Detection strategy:
//   Input image: title 'input'/'product'/'image', else the sole LoadImage
//     node if there's exactly one (same fallback as detectBackgroundRemovalMappings).
//   Result: title containing 'result'/'output', else the sole SaveImage node.
//   Prompts: title 'positive_prompt'/'negative_prompt', falling back to
//     whichever TextEncode* node feeds a KSampler*'s positive/negative input
//     — same two-pass strategy as detectMappings/detectProductMappings, since
//     the reference fabric-to-garment workflow doesn't title its
//     TextEncodeQwenImageEditPlus nodes this way.

import { classifyNode, normaliseTitle, type ParsedNode } from './workflow-detect.js';

export interface DetectedFabricMappings {
  inputNodeId?: string;
  resultNodeId?: string;
  positivePromptNode?: string;
  negativePromptNode?: string;
}

type WorkflowNode = {
  class_type?: string;
  _meta?: { title?: string };
  inputs?: Record<string, unknown>;
};

// Build reverse link map: nodeId → [{consumerId, inputName}]
// ComfyUI API format encodes links as [sourceNodeId, outputIndex] arrays.
function buildReverseLinks(
  json: Record<string, unknown>,
): Map<string, { consumerId: string; inputName: string }[]> {
  const rev = new Map<string, { consumerId: string; inputName: string }[]>();
  for (const [consumerId, raw] of Object.entries(json)) {
    const node = raw as WorkflowNode;
    if (!node?.inputs) continue;
    for (const [inputName, val] of Object.entries(node.inputs)) {
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string') {
        const srcId = val[0] as string;
        if (!rev.has(srcId)) rev.set(srcId, []);
        rev.get(srcId)?.push({ consumerId, inputName });
      }
    }
  }
  return rev;
}

export function detectFabricMappings(json: Record<string, unknown>): {
  detected: DetectedFabricMappings;
  allImageNodes: ParsedNode[];
  allSaveImageNodes: ParsedNode[];
  allPromptNodes: ParsedNode[];
} {
  const allImageNodes: ParsedNode[] = [];
  const allSaveImageNodes: ParsedNode[] = [];
  const allPromptNodes: ParsedNode[] = [];
  const detected: DetectedFabricMappings = {};

  let titledInputId: string | undefined;
  let titledResultId: string | undefined;

  for (const [nodeId, raw] of Object.entries(json)) {
    const node = raw as WorkflowNode;
    if (!node?.class_type) continue;
    const classType = node.class_type;
    const title = node._meta?.title ?? nodeId;
    const norm = normaliseTitle(title);
    const category = classifyNode(classType);

    if (category === 'image') {
      allImageNodes.push({ id: nodeId, class_type: classType, title, category });
      if (norm === 'input' || norm === 'product' || norm === 'image') {
        titledInputId = nodeId;
      }
    } else if (category === 'prompt') {
      allPromptNodes.push({ id: nodeId, class_type: classType, title, category });
      if (norm === 'positive_prompt') {
        detected.positivePromptNode = nodeId;
      } else if (norm === 'negative_prompt') {
        detected.negativePromptNode = nodeId;
      }
    } else if (classType === 'SaveImage') {
      allSaveImageNodes.push({ id: nodeId, class_type: classType, title, category: 'other' });
      if (norm.includes('result') || norm.includes('output')) {
        titledResultId = nodeId;
      }
    }
  }

  // Connection-based fallback: TextEncode* node whose output feeds a
  // KSampler*'s positive/negative input, regardless of title.
  if (!detected.positivePromptNode || !detected.negativePromptNode) {
    const rev = buildReverseLinks(json);
    for (const node of allPromptNodes) {
      if (detected.positivePromptNode && detected.negativePromptNode) break;
      const links = rev.get(node.id) ?? [];
      for (const { consumerId, inputName } of links) {
        const consumer = json[consumerId] as WorkflowNode | undefined;
        const consumerClass = consumer?.class_type ?? '';
        if (!consumerClass.includes('Sampler') && !consumerClass.includes('sampler')) continue;
        if (inputName === 'positive' && !detected.positivePromptNode) {
          detected.positivePromptNode = node.id;
        } else if (inputName === 'negative' && !detected.negativePromptNode) {
          detected.negativePromptNode = node.id;
        }
      }
    }
  }

  allImageNodes.sort((a, b) => a.title.localeCompare(b.title));
  allSaveImageNodes.sort((a, b) => a.title.localeCompare(b.title));
  allPromptNodes.sort((a, b) => a.title.localeCompare(b.title));

  detected.inputNodeId =
    titledInputId ?? (allImageNodes.length === 1 ? allImageNodes[0]?.id : undefined);
  detected.resultNodeId =
    titledResultId ?? (allSaveImageNodes.length === 1 ? allSaveImageNodes[0]?.id : undefined);

  return { detected, allImageNodes, allSaveImageNodes, allPromptNodes };
}
