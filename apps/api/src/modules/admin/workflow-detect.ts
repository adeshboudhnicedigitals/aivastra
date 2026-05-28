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
  sizeNodeId?: string;
  positivePromptNode?: string;
  negativePromptNode?: string;
}

export function classifyNode(classType: string): NodeCategory {
  if (classType === 'LoadImage') return 'image';
  if (classType.includes('TextEncode')) return 'prompt';
  if (classType === 'EmptyLatentImage') return 'latent';
  return 'other';
}

export function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

export function detectMappings(json: Record<string, unknown>): {
  detected: DetectedMappings;
  allImageNodes: ParsedNode[];
  allPromptNodes: ParsedNode[];
  allLatentNodes: ParsedNode[];
} {
  const detected: DetectedMappings = { upperNodeIds: [] };
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
      if (norm === 'size') {
        detected.sizeNodeId = nodeId;
      }
    }
  }

  allImageNodes.sort((a, b) => a.title.localeCompare(b.title));
  allPromptNodes.sort((a, b) => a.title.localeCompare(b.title));
  allLatentNodes.sort((a, b) => a.title.localeCompare(b.title));

  return { detected, allImageNodes, allPromptNodes, allLatentNodes };
}
