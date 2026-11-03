// Pure rules for the fleet inventory; the routes do the queries. Kept free of I/O so the
// consistency rules (a worker's GPU must be on its host, nothing in use can be deleted) are tested.

export type GpuRef = { id: string; hostId: string };

/** A worker maps to a GPU, and that GPU must sit on the host the worker names. */
export function mappingError(
  hostId: string,
  gpuId: string,
  gpu: GpuRef | undefined,
): string | null {
  if (!gpu) return `GPU ${gpuId} does not exist.`;
  if (gpu.hostId !== hostId) return `GPU ${gpuId} is on host ${gpu.hostId}, not ${hostId}.`;
  return null;
}

export function hostDeleteError(counts: {
  gpus: number;
  workers: number;
  reviews: number;
}): string | null {
  if (counts.workers > 0)
    return `Host still has ${counts.workers} mapped worker${counts.workers === 1 ? '' : 's'}; unmap them first.`;
  if (counts.gpus > 0)
    return `Host still has ${counts.gpus} GPU${counts.gpus === 1 ? '' : 's'}; delete them first.`;
  // Reviews are an append-only record; deleting the host would orphan or erase it.
  if (counts.reviews > 0)
    return 'Host has recorded reviews, which are kept; mark it unverified instead of deleting it.';
  return null;
}

export function gpuDeleteError(workers: number): string | null {
  return workers > 0
    ? `GPU still has ${workers} mapped worker${workers === 1 ? '' : 's'}; unmap them first.`
    : null;
}

/** numeric(10,2) comes back from Postgres as a string. */
export function moneyOut(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function moneyIn(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** Only the fields that actually changed, for the audit row. */
export function changedFields<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
): { before: Partial<T> | null; after: Partial<T> } {
  if (!before) return { before: null, after };
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (before[key] !== after[key]) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}
