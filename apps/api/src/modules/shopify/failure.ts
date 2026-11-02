import { randomBytes } from 'node:crypto';

/**
 * What a shopper can be told about a failed try-on without exposing internals.
 * The dispatcher's `errorCode` is a free-form internal string (workflow ids,
 * provider/exception text), so it is collapsed to one of three kinds here and
 * the widget owns the wording:
 *  - PHOTO:   the input photo is what the pipeline could not use.
 *  - BUSY:    no capacity right now; retrying later is the right move.
 *  - SERVICE: our side is broken or misconfigured; retrying will not help.
 */
export type FailureKind = 'PHOTO' | 'BUSY' | 'SERVICE';

const PHOTO_CODES = new Set(['NO_FACE_IMAGE', 'MANNEQUIN_NO_FACE_IMAGE', 'MISSING_SOURCE_IMAGE']);
const BUSY_CODES = new Set([
  'NO_WORKER',
  'PREFERRED_WORKERS_UNAVAILABLE',
  'WAITING_FOR_WORKER',
  'STUCK_IN_FLIGHT',
]);

export function classifyJobFailure(errorCode: string | null | undefined): FailureKind {
  if (errorCode && PHOTO_CODES.has(errorCode)) return 'PHOTO';
  if (errorCode && BUSY_CODES.has(errorCode)) return 'BUSY';
  return 'SERVICE';
}

/** Short quotable reference for a job: the id's first 8 hex chars, upper-cased, searchable in logs. */
export function jobRef(jobId: string): string {
  return jobId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Reference for a failed HTTP request, which has no job id to borrow. */
export function requestRef(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}
