// Pure workflow node auto-detection — extracted here so it can be unit-tested
// without spinning up a Fastify instance or database.
//
// Detection strategy (two passes):
//   Pass 1 — title matching (set _meta.title in ComfyUI):
//     LoadImage titles: face, pose, background/bg, upper_garment[_N],
//                       lower_garment, shoes/shoe
//     TextEncode titles: positive_prompt, negative_prompt
//     Latent titles: size, empty_latent_image (or auto-assigned by class_type)
//
//   Pass 2 — connection-based fallback for anything unresolved after pass 1:
//     positive_prompt: TextEncode node whose output → KSampler*.positive
//     negative_prompt: TextEncode node whose output → KSampler*.negative
//
// Number of LoadImage inputs varies by workflow (closeup has no lower/shoes,
// twopiece has both). Absent roles produce undefined — patcher handles nulls.

export type NodeCategory = 'image' | 'prompt' | 'latent' | 'other';

export interface ParsedNode {
  id: string;
  class_type: string;
  title: string;
  category: NodeCategory;
}

export interface DetectedMappings {
  faceNodeId?: string;
  poseNodeId?: string;
  bgNodeId?: string;
  upperNodeIds: string[];
  lowerNodeId?: string;
  shoeNodeId?: string;
  sizeNodeIds: string[];
  positivePromptNode?: string;
  negativePromptNode?: string;
}

// Node class_types that control output dimensions (EmptyLatentImage + resize nodes)
const SIZE_CLASS_TYPES = new Set([
  'EmptyLatentImage',
  'ResizeImageMaskNode',
  'ResizeAndPadImage',
  'ImageResizeKJ',
  'LatentUpscaleBy',
]);

export function classifyNode(classType: string): NodeCategory {
  if (classType === 'LoadImage') return 'image';
  if (classType.includes('TextEncode')) return 'prompt';
  if (SIZE_CLASS_TYPES.has(classType)) return 'latent';
  return 'other';
}

export function normaliseTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
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
        rev.get(srcId)!.push({ consumerId, inputName });
      }
    }
  }
  return rev;
}

export function detectMappings(json: Record<string, unknown>): {
  detected: DetectedMappings;
  allImageNodes: ParsedNode[];
  allPromptNodes: ParsedNode[];
  allLatentNodes: ParsedNode[];
} {
  const detected: DetectedMappings = { upperNodeIds: [], sizeNodeIds: [] };
  const allImageNodes: ParsedNode[] = [];
  const allPromptNodes: ParsedNode[] = [];
  const allLatentNodes: ParsedNode[] = [];

  // ── Pass 1: title-based detection ────────────────────────────────────────
  for (const [nodeId, raw] of Object.entries(json)) {
    const node = raw as WorkflowNode;
    if (!node?.class_type) continue;
    const classType = node.class_type;
    const title = node._meta?.title ?? nodeId;
    const norm = normaliseTitle(title);
    const category = classifyNode(classType);

    if (category === 'image') {
      allImageNodes.push({ id: nodeId, class_type: classType, title, category });
      if (norm === 'face') {
        detected.faceNodeId = nodeId;
      } else if (norm === 'pose') {
        detected.poseNodeId = nodeId;
      } else if (norm === 'background' || norm === 'bg') {
        detected.bgNodeId = nodeId;
      } else if (norm === 'upper_garment' || /^upper_garment_\d+$/.test(norm)) {
        detected.upperNodeIds.push(nodeId);
      } else if (norm === 'lower_garment') {
        detected.lowerNodeId = nodeId;
      } else if (norm === 'shoes' || norm === 'shoe') {
        detected.shoeNodeId = nodeId;
      }
    } else if (category === 'prompt') {
      allPromptNodes.push({ id: nodeId, class_type: classType, title, category });
      if (norm === 'positive_prompt') {
        detected.positivePromptNode = nodeId;
      } else if (norm === 'negative_prompt') {
        detected.negativePromptNode = nodeId;
      }
    } else if (category === 'latent') {
      allLatentNodes.push({ id: nodeId, class_type: classType, title, category });
    }
  }

  // ── Pass 2: connection-based fallback for unresolved prompt nodes ─────────
  // Find TextEncode nodes whose output feeds into a KSampler* node as
  // 'positive' or 'negative' — reliable regardless of node title.
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
  allPromptNodes.sort((a, b) => a.title.localeCompare(b.title));
  allLatentNodes.sort((a, b) => a.title.localeCompare(b.title));

  // Always use ALL latent nodes as sizeNodeIds.
  // A partial list (e.g. only EmptyLatentImage) leaves ResizeAndPadImage /
  // ResizeImageMaskNode nodes at stale hardcoded dimensions when aspectRatio changes.
  detected.sizeNodeIds = allLatentNodes.map((n) => n.id);

  return { detected, allImageNodes, allPromptNodes, allLatentNodes };
}
