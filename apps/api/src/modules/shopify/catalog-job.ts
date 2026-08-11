import { type DB, schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { type CreateTryOnJobRequest, JOB_SOURCE } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { atomicDeductStore, refundStoreAndMarkFailed } from '../credits/shopify-ledger.js';
import { resolveTryonPlan, verifyGarmentKey } from '../jobs/create.js';
import { promptGuard } from '../jobs/sanitize.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Store-billed sibling of jobs/create.ts's createJob, used only by the Shopify
 * merchant "Generate" flow (catalog.routes.ts). No `users` row backs a store,
 * so this skips the banned-check and tier/queueStream/watermark lookup that
 * createJob does for regular web-app users — jobs get the schema defaults
 * (queueStream 'normal', priority false, watermark false), matching what
 * customer.routes.ts's Shopify widget-job insert already relies on today.
 * `mannequinJobId` is never part of `GenerateBody`, so unlike createJob this
 * never needs resolveMannequinGarmentKey's per-user ownership check.
 */
export async function createShopifyStoreCatalogJob(
  app: FastifyInstance,
  store: Store,
  body: z.infer<typeof CreateTryOnJobRequest>,
  opts: { trustedGarmentKeys: Set<string> },
): Promise<{ catalogueId: string; jobIds: string[] }> {
  const { faceId, garmentTypeId, upperGarmentKey, lowerGarmentKey, thirdGarmentKey } = body.inputs;

  // Mirrors createJob's own verification calls (jobs/create.ts) — upperGarmentKey
  // is always in trustedGarmentKeys for this caller (the freshly downloaded R2 key
  // catalog.routes.ts just wrote), so this resolves to assertGarmentObjectValid,
  // not an ownership check. lowerGarmentKey/thirdGarmentKey are never populated by
  // GenerateBody today (it only sends lowerCatalogId/shoeCatalogId), but the checks
  // stay for parity with createJob in case that ever changes.
  if (upperGarmentKey) await verifyGarmentKey(app, null, upperGarmentKey, opts.trustedGarmentKeys);
  if (lowerGarmentKey) await verifyGarmentKey(app, null, lowerGarmentKey, opts.trustedGarmentKeys);
  if (thirdGarmentKey) await verifyGarmentKey(app, null, thirdGarmentKey, opts.trustedGarmentKeys);

  const plan = await resolveTryonPlan(app, null, body, {
    resolvedUpperGarmentKey: upperGarmentKey ?? null,
    trustedGarmentKeys: opts.trustedGarmentKeys,
  });

  const jobIds = await app.db.transaction(async (tx) => {
    const created: string[] = [];
    for (const look of plan.looks) {
      const [job] = await tx
        .insert(schema.jobs)
        .values({
          shopifyStoreId: store.id,
          catalogueId: plan.catalogueId,
          status: 'QUEUED',
          creditsCharged: plan.cost,
          source: JOB_SOURCE.SHOPIFY,
        })
        .returning();
      await atomicDeductStore(tx as unknown as DB, store.id, plan.cost, job.id);
      await tx.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey: look.upperGarmentKey,
        faceId,
        backgroundId: look.backgroundId,
        poseId: look.poseId,
        garmentTypeId: garmentTypeId ?? null,
        lowerCatalogId: look.lowerCatalogId,
        lowerGarmentKey: look.lowerGarmentKey,
        thirdGarmentKey: thirdGarmentKey ?? null,
        shoeCatalogId: look.shoeCatalogId,
        userHint: promptGuard(body.userHint),
        params: look.params,
      });
      created.push(job.id);
    }
    return created;
  });

  const stream = 'jobs:normal';
  const failedEnqueues: string[] = [];
  for (const jobId of jobIds) {
    try {
      await app.redis.xadd(
        stream,
        'MAXLEN',
        '~',
        10000,
        '*',
        'jobId',
        jobId,
        'shopifyStoreId',
        store.id,
      );
      jobsCreatedTotal.inc({ priority: 'normal', kind: JOB_SOURCE.SHOPIFY });
    } catch (err) {
      app.log.error({ err, jobId }, 'redis xadd failed — shopify catalog job will be refunded');
      failedEnqueues.push(jobId);
    }
  }

  if (failedEnqueues.length > 0) {
    await Promise.all(
      failedEnqueues.map((jobId) =>
        refundStoreAndMarkFailed(
          app.db,
          store.id,
          plan.cost,
          jobId,
          'REFUND_ENQUEUE_FAIL',
          'ENQUEUE_FAIL',
        ),
      ),
    );
    if (failedEnqueues.length === jobIds.length) {
      throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
    }
  }

  return { catalogueId: plan.catalogueId, jobIds };
}
