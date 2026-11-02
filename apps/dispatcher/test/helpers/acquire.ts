import type { DB } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import { type Acquisition, acquireComfyJob } from '../../src/job/ownership.js';
import { beginProcessing } from '../../src/job/start.js';

/**
 * Admission plus the QUEUED to PREPROCESSING change a processing job makes once it reserves a
 * worker (acquisition alone leaves the job QUEUED). For fixtures that stand in for a job already
 * past its worker claim.
 */
export async function acquireAndStart(
  db: DB,
  pub: Redis,
  jobId: string,
  session: string,
  log: Logger,
): Promise<Acquisition> {
  const acquired = await acquireComfyJob(db, jobId, session, log);
  if (acquired.kind === 'Acquired') await beginProcessing({ db, pub, owner: acquired.owner, log });
  return acquired;
}
