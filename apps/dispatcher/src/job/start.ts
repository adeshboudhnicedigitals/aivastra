import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { forgetWaiting } from '../stream/parked.js';
import { assertOwnerInTransaction, isTerminalStatus, type OwnerToken } from './ownership.js';

/** The job finished (a cancel during the wait, an admin action) before a worker was used. */
export class JobFinishedBeforeStartError extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} finished before processing started`);
  }
}

/** The SSE a job's status change goes out on (the store's channel for a Shopify job). */
export async function publishPreprocessing(
  pub: Redis,
  opts: { jobId: string; userId: string; shopifyStoreId?: string },
): Promise<void> {
  const channelId = opts.shopifyStoreId ? `store:${opts.shopifyStoreId}` : opts.userId;
  const payload = JSON.stringify({
    jobId: opts.jobId,
    userId: opts.userId,
    type: 'STATUS',
    status: 'PREPROCESSING',
    ...(opts.shopifyStoreId ? { shopifyStoreId: opts.shopifyStoreId } : {}),
  });
  const publishes = [pub.publish('sse:events:admin', payload)];
  if (channelId) publishes.push(pub.publish(`sse:events:${channelId}`, payload));
  await Promise.all(publishes);
}

/**
 * QUEUED to PREPROCESSING, with its event and SSE, once a worker is reserved and before any
 * upload. A job that waits for a worker stays QUEUED, so it shows one state instead of one
 * PREPROCESSING event per retry.
 *
 * One transaction checks ownership (jobs row first, then the control row) before writing, so a
 * job cancelled while it waited is found finished here: the caller releases the reservation and
 * ACKs, with no upload and no POST. A job that is already past QUEUED (a restart of an adopted
 * job, a second phase) changes nothing.
 */
export async function beginProcessing(args: {
  db: DB;
  pub: Redis;
  owner: OwnerToken;
  log: Logger;
}): Promise<void> {
  const { db, pub, owner, log } = args;
  const flipped = await db.transaction(async (tx) => {
    const status = await assertOwnerInTransaction(tx, owner, 'start:preprocessing');
    if (isTerminalStatus(status)) throw new JobFinishedBeforeStartError(owner.jobId);
    if (status !== 'QUEUED') return undefined;
    const [job] = await tx
      .select({
        userId: schema.jobs.userId,
        merchantId: schema.jobs.merchantId,
        shopifyStoreId: schema.jobs.shopifyStoreId,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, owner.jobId));
    await tx
      .update(schema.jobs)
      .set({ status: 'PREPROCESSING' })
      .where(eq(schema.jobs.id, owner.jobId));
    await tx.insert(schema.jobEvents).values({
      jobId: owner.jobId,
      eventType: 'PREPROCESSING',
      // Shopify's PREPROCESSING event has always carried its store id.
      payload: job?.shopifyStoreId ? { shopifyStoreId: job.shopifyStoreId } : {},
    });
    return job;
  });
  forgetWaiting(owner.jobId);
  if (flipped === undefined) return;
  const widgetJob = !!(flipped.merchantId || flipped.shopifyStoreId);
  await publishPreprocessing(pub, {
    jobId: owner.jobId,
    userId: widgetJob ? '' : (flipped.userId ?? ''),
    shopifyStoreId: flipped.shopifyStoreId ?? undefined,
  }).catch((err) => log.warn({ err, jobId: owner.jobId }, 'could not publish PREPROCESSING'));
}
