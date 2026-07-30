import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { JOB_SOURCE } from '@aivastra/types';

interface CreateMerchantTryonJobInput {
  merchantId: string;
  merchantUserId: string;
  upperGarmentKey: string;
  customerPhotoKey: string;
  workflowTemplateId: string;
}

// Unlimited try-ons for now: creditsCharged is always 0 and no billing helper is called.
export async function createMerchantTryonJob(
  app: FastifyInstance,
  input: CreateMerchantTryonJobInput,
): Promise<string> {
  const jobId = randomUUID();

  await app.db.transaction(async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: input.merchantUserId,
      merchantId: input.merchantId,
      kioskDeviceId: null,
      customerPhotoKey: input.customerPhotoKey,
      status: 'QUEUED',
      creditsCharged: 0,
      source: JOB_SOURCE.MERCHANT_TRYON,
    });

    // biome-ignore lint/suspicious/noExplicitAny: nullable widget inputs are wider than Drizzle's inferred insert type.
    await (tx.insert(schema.jobInputs).values as any)({
      jobId,
      upperGarmentKey: input.upperGarmentKey,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { workflowTemplateId: input.workflowTemplateId },
    });
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
