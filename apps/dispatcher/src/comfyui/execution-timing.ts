export interface ExecutionTiming {
  executionStartMs: number;
  executionSuccessMs: number;
  cachedNodeCount: number;
  totalNodeCount: number;
}

export interface TimingHistory {
  status?: { messages?: [string, Record<string, unknown>][] };
}

export function executionTiming(
  entry: TimingHistory | undefined,
  totalNodeCount = 0,
): ExecutionTiming | undefined {
  const messages = entry?.status?.messages;
  if (!Array.isArray(messages)) return undefined;
  const start = messages.find((message) => message?.[0] === 'execution_start')?.[1]?.timestamp;
  const success = messages.find((message) => message?.[0] === 'execution_success')?.[1]?.timestamp;
  if (
    typeof start !== 'number' ||
    !Number.isFinite(start) ||
    typeof success !== 'number' ||
    !Number.isFinite(success)
  )
    return undefined;
  const nodes = messages.find((message) => message?.[0] === 'execution_cached')?.[1]?.nodes;
  return {
    executionStartMs: start,
    executionSuccessMs: success,
    cachedNodeCount: Array.isArray(nodes) ? nodes.length : 0,
    totalNodeCount,
  };
}
