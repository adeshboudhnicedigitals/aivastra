export const NODE_COUNT_RULE_RELIABLE = false;

export function performanceKey(template: {
  id: string;
  updatedAt: Date;
  performanceArchivedVersion?: number;
}): string {
  return template.performanceArchivedVersion === undefined
    ? `${template.id}:${template.updatedAt.getTime()}`
    : `${template.id}:v${template.performanceArchivedVersion}:archived`;
}

export function promptNodeCount(prompt: Record<string, unknown>): {
  totalNodeCount: number;
  reliable: boolean;
} {
  // API shape identifies candidate nodes, but custom execution/output semantics live on the GPU.
  const nodes = Object.values(prompt).filter(
    (node) =>
      node &&
      typeof node === 'object' &&
      typeof (node as { class_type?: unknown }).class_type === 'string',
  );
  return { totalNodeCount: nodes.length, reliable: NODE_COUNT_RULE_RELIABLE };
}
