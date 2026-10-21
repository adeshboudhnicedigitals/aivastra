// When a workflow finishes "successfully" but its result node produced no image, the cause is
// ambiguous: the template's own gate may have withheld the output on purpose (e.g. a photo the
// workflow rejects), or the template/node mapping is broken. Telling them apart matters — the
// first is a user-facing "use a different photo", the second is a template bug nobody should
// blame on the shopper. Both are deterministic, so neither is worth a second GPU run.

export const OUTPUT_WITHHELD = 'OUTPUT_WITHHELD';
export const RESULT_NODE_NOT_IN_WORKFLOW = 'RESULT_NODE_NOT_IN_WORKFLOW';

const TERMINAL_JOB_ERROR_CODES = new Set([OUTPUT_WITHHELD, RESULT_NODE_NOT_IN_WORKFLOW]);

/** Errors whose cause the same inputs would reproduce — retrying only burns GPU time. */
export function isTerminalJobError(message: string | undefined): boolean {
  return message !== undefined && TERMINAL_JOB_ERROR_CODES.has(message);
}

export interface EmptyOutputHistoryEntry {
  status?: { status_str?: string; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, unknown>;
  /** ComfyUI history `prompt` tuple: [number, prompt_id, graph, extra_data, outputs_to_execute]. */
  prompt?: unknown[];
}

export type EmptyOutputVerdict = 'withheld' | 'node_not_in_workflow' | 'unknown';

/**
 * Classifies a finished run whose result node has no output image. Conservative on purpose:
 * anything it cannot positively establish is 'unknown', which keeps the existing generic
 * failure (and its retry) rather than blaming the customer's photo for a pipeline problem.
 */
export function classifyEmptyOutput(
  entry: EmptyOutputHistoryEntry,
  resultNodeId: string | undefined,
): EmptyOutputVerdict {
  if (!resultNodeId || entry.status?.status_str !== 'success') return 'unknown';

  const graph = entry.prompt?.[2];
  if (!graph || typeof graph !== 'object') return 'unknown';
  // The configured result node is not in the workflow that ran: template drift, not the photo.
  if (!(resultNodeId in graph)) return 'node_not_in_workflow';

  // Only an output node ComfyUI actually meant to run can have been withheld.
  const toExecute = entry.prompt?.[4];
  if (!Array.isArray(toExecute) || !toExecute.map(String).includes(resultNodeId)) return 'unknown';

  // A fully cached output node can also be missing from outputs.
  const cached = entry.status?.messages?.find(([type]) => type === 'execution_cached')?.[1]?.nodes;
  if (Array.isArray(cached) && cached.map(String).includes(resultNodeId)) return 'unknown';

  // The node ran but yielded no `output`-type image (e.g. only temp previews): not a gate.
  if (entry.outputs?.[resultNodeId] !== undefined) return 'unknown';

  return 'withheld';
}
