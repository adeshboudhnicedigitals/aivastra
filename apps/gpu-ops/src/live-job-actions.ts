export type JobActionResult = {
  jobId: string;
  status: 'CANCELLED' | 'QUEUED';
  refunded: boolean;
};

export class JobActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseJobActionResult(value: unknown): JobActionResult {
  if (
    !isObj(value) ||
    typeof value.jobId !== 'string' ||
    (value.status !== 'CANCELLED' && value.status !== 'QUEUED') ||
    typeof value.refunded !== 'boolean'
  )
    throw new JobActionError(0, 'Fleet API returned an unexpected job action response.');
  return { jobId: value.jobId, status: value.status, refunded: value.refunded };
}

export function jobActionErrorMessage(error: unknown): string {
  if (error instanceof JobActionError && error.status === 401)
    return 'Session expired, sign in again.';
  if (error instanceof JobActionError && error.status === 403)
    return 'Your role lacks fleet.operate (SUPER_ADMIN).';
  return error instanceof Error ? error.message : 'Fleet API request failed.';
}

async function act(
  baseUrl: string,
  token: string,
  id: string,
  kind: 'cancel' | 'retry',
  reason: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JobActionResult> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${baseUrl.replace(/\/$/, '')}/admin/fleet/jobs/${encodeURIComponent(id)}/${kind}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new JobActionError(0, 'Fleet API unavailable.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    // The API's error envelope is { error: { code, message } }.
    const message =
      isObj(payload) && isObj(payload.error) && typeof payload.error.message === 'string'
        ? payload.error.message
        : `Fleet API returned ${response.status}.`;
    throw new JobActionError(response.status, message);
  }
  return parseJobActionResult(await response.json().catch(() => null));
}

export const cancelQueuedJob = (
  b: string,
  t: string,
  id: string,
  reason: string,
  f?: typeof fetch,
) => act(b, t, id, 'cancel', reason, f);
export const retryFailedJob = (
  b: string,
  t: string,
  id: string,
  reason: string,
  f?: typeof fetch,
) => act(b, t, id, 'retry', reason, f);

/** Which action the job's status offers. The server enforces the same rule and more. */
export function jobActionFor(status: string): 'cancel' | 'retry' | null {
  if (status === 'QUEUED') return 'cancel';
  if (status === 'FAILED') return 'retry';
  return null;
}

export function jobActionNotice(kind: 'cancel' | 'retry', result: JobActionResult): string {
  if (kind === 'cancel')
    return result.refunded
      ? 'Job cancelled and the customer’s credits were returned.'
      : 'Job cancelled (it cost no credits).';
  return result.refunded
    ? 'Job re-queued. Its failure had already been refunded, so this run does not charge again.'
    : 'Job re-queued.';
}
