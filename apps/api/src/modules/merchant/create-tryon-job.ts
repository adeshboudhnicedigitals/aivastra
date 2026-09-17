import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicMerchantDeduct } from './ledger.js';

interface CreateMerchantTryonJobInput {
  merchantId: string;
  merchantUserId: string;
  upperGarmentKey: string;
  customerPhotoKey: string;
  workflowTemplateId: string;
  dispatchTemplateVersion?: number | null;
}

export async function createMerchantTryonJob(
  app: FastifyInstance,
  input: CreateMerchantTryonJobInput,
): Promise<string> {
  const jobId = randomUUID();
  const cost = await getTryonCreditCost(app);

  await app.db.transaction(async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: input.merchantUserId,
      merchantId: input.merchantId,
      customerPhotoKey: input.customerPhotoKey,
      status: 'QUEUED',
      creditsCharged: cost,
      source: JOB_SOURCE.MERCHANT_TRYON,
    });

    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobInputs).values as any)({
      jobId,
      upperGarmentKey: input.upperGarmentKey,
      thirdGarmentKey: null,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: {
        workflowTemplateId: input.workflowTemplateId,
        dispatchTemplateVersion: input.dispatchTemplateVersion ?? null,
      },
    });

    // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the merchant ledger helper.
    await atomicMerchantDeduct(tx as any, input.merchantId, cost, jobId);
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'userId',
    input.merchantUserId,
    'type',
    'MERCHANT_TRYON',
  );

  return jobId;
}

interface CreateMerchantTryonJobTwoStepInput {
  merchantId: string;
  merchantUserId: string;
  customerPhotoKey: string;
  bodyKey: string;
  palluKey: string;
  garmentSubcategoryId: string;
  merchantCatalogItemId: string;
  mannequinWorkflowTemplateId: string;
  mannequinWorkflowTemplateVersion?: number | null;
  tryonWorkflowTemplateId: string;
  tryonWorkflowTemplateVersion?: number | null;
}

/**
 * Two-input (body + pallu) merchant catalog item: no single-pass 3-input ComfyUI
 * template exists (see ResolvedTwoInputTryonGarment), so this mirrors
 * createMerchantCatalogJob's two-step branch (create-job.ts) — a 0-credit
 * mannequin-drape job (body+pallu -> one draped image), then a normal
 * PENDING_MANNEQUIN tryon job against the *real* customer's photo (not an
 * admin-curated face, unlike the catalog-generation case). Only the mannequin
 * job is enqueued here; apps/dispatcher/src/job/saree-step2-promoter.ts (already
 * running, unmodified — it keys off status/params.mannequinJobId with no
 * source-specific branching) promotes the tryon job to QUEUED once the
 * mannequin job completes, patching its upperGarmentKey to the drape's output.
 * `merchantCatalogItemId` in step-2's params is what lets that same promoter
 * also cache the drape's output key onto merchantCatalogItems.mannequinResultKey,
 * so resolveTryonGarment can skip this whole two-step dance on every later
 * try-on of the same catalog item.
 */
export async function createMerchantTryonJobTwoStep(
  app: FastifyInstance,
  input: CreateMerchantTryonJobTwoStepInput,
): Promise<string> {
  const mannequinJobId = randomUUID();
  const jobId = randomUUID();
  const cost = await getTryonCreditCost(app);

  await app.db.transaction(async (tx) => {
    await tx.insert(schema.jobs).values({
      id: mannequinJobId,
      userId: input.merchantUserId,
      status: 'QUEUED',
      watermark: false,
      queueStream: 'normal',
      creditsCharged: 0,
      source: JOB_SOURCE.SAREE_MANNEQUIN,
    });
    await tx.insert(schema.jobInputs).values({
      jobId: mannequinJobId,
      upperGarmentKey: input.bodyKey,
      thirdGarmentKey: input.palluKey,
      faceId: null,
      garmentTypeId: input.garmentSubcategoryId,
      params: {
        kind: 'saree_mannequin',
        workflowTemplateId: input.mannequinWorkflowTemplateId,
        dispatchTemplateVersion: input.mannequinWorkflowTemplateVersion ?? null,
      },
    });

    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: input.merchantUserId,
      merchantId: input.merchantId,
      customerPhotoKey: input.customerPhotoKey,
      status: 'PENDING_MANNEQUIN',
      creditsCharged: cost,
      source: JOB_SOURCE.MERCHANT_TRYON,
    });
    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobInputs).values as any)({
      jobId,
      upperGarmentKey: null,
      thirdGarmentKey: null,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: {
        workflowTemplateId: input.tryonWorkflowTemplateId,
        dispatchTemplateVersion: input.tryonWorkflowTemplateVersion ?? null,
        mannequinJobId,
        merchantCatalogItemId: input.merchantCatalogItemId,
      },
    });

    // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the merchant ledger helper.
    await atomicMerchantDeduct(tx as any, input.merchantId, cost, jobId);
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    mannequinJobId,
    'userId',
    input.merchantUserId,
  );

  return jobId;
}
