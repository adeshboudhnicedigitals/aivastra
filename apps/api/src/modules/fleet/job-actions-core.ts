// Pure rules for cancelling and retrying a job from the fleet dashboard. The routes do the I/O.
// These are deliberately stricter than the admin panel's own job routes: anything that touches a
// job already running on a GPU, or a store-billed job, stays in the admin panel.

export type JobFacts = {
  status: string;
  source: string | null;
  userId: string | null;
  shopifyStoreId: string | null;
};

export function cancelBlock(job: JobFacts): string | null {
  if (job.status === 'CANCELLED') return 'This job is already cancelled.';
  if (job.status !== 'QUEUED')
    return `Only a queued job can be cancelled here (this one is ${job.status}). A job already running on a GPU is not interrupted from this dashboard.`;
  if (job.shopifyStoreId)
    return 'This job is billed to a Shopify store; cancel it from the admin panel, which also returns the store credit and cap slot.';
  if (!job.userId)
    return 'This job has no customer account to refund; cancel it from the admin panel.';
  return null;
}

export function retryBlock(job: JobFacts): string | null {
  if (job.status !== 'FAILED')
    return `Only a failed job can be retried (this one is ${job.status}).`;
  if (job.source === 'comparison')
    return 'Comparison jobs are replayed from their own page and cannot be retried here.';
  if (job.shopifyStoreId)
    return 'This job is billed to a Shopify store; retry it from the admin panel.';
  return null;
}

/** The Redis stream a retried job goes back onto: its own lane, else priority/normal. */
export function retryStream(job: { queueStream: string | null; priority: boolean | null }): string {
  return `jobs:${job.queueStream ?? (job.priority ? 'priority' : 'normal')}`;
}
