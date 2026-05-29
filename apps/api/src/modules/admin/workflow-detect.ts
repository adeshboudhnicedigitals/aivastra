// Pure workflow node auto-detection — extracted here so it can be unit-tested
// without spinning up a Fastify instance or database.
//
// Naming convention (set _meta.title in ComfyUI):
//   Required LoadImage : face, pose, background, upper_garment[_N]
//   Optional LoadImage : lower_garment, shoes
//   Required TextEncode: positive_prompt, negative_prompt
//   Optional latent    : size  (EmptyLatentImage)

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

  for (const [nodeId, raw] of Object.entries(json)) {
    const node = raw as { class_type?: string; _meta?: { title?: string } };
    const classType = node.class_type ?? '';
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
      } else if (norm === 'upper_garment' || norm.match(/^upper_garment_\d+$/)) {
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
      // Collect any node titled "size" or "empty_latent_image" as a dimension control node
      if (norm === 'size' || norm === 'empty_latent_image') {
        detected.sizeNodeIds.push(nodeId);
      }
    }
  }

  allImageNodes.sort((a, b) => a.title.localeCompare(b.title));
  allPromptNodes.sort((a, b) => a.title.localeCompare(b.title));
  allLatentNodes.sort((a, b) => a.title.localeCompare(b.title));

  // If no size nodes were detected by title, auto-assign all latent nodes.
  // ComfyUI exports default titles like "Empty Latent Image" or "ResizeAndPadImage".
  if (detected.sizeNodeIds.length === 0 && allLatentNodes.length > 0) {
    detected.sizeNodeIds = allLatentNodes.map((n) => n.id);
  }

  return { detected, allImageNodes, allPromptNodes, allLatentNodes };
}
