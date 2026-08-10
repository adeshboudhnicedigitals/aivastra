import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { atomicMerchantDeduct } from '../merchant/ledger.js';

interface CreateKioskJobInput {
  merchantId: string;
  kioskDeviceId?: string;
  upperGarmentKey: string;
  customerPhotoKey: string;
  cost: number;
  workflowTemplateId: string;
}

export async function createKioskJob(
  app: FastifyInstance,
  input: CreateKioskJobInput,
): Promise<string> {
  const jobId = randomUUID();

  await app.db.transaction(async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId/FK cols as non-null; kiosk jobs legitimately have null userId and null face/bg/pose.
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: null,
      merchantId: input.merchantId,
      kioskDeviceId: input.kioskDeviceId ?? null,
      customerPhotoKey: input.customerPhotoKey,
      status: 'QUEUED',
      creditsCharged: input.cost,
      source: JOB_SOURCE.KIOSK,
    });

    // biome-ignore lint/suspicious/noExplicitAny: same - face/bg/pose are nullable in SQL but Drizzle types them non-null.
    await (tx.insert(schema.jobInputs).values as any)({
      jobId,
      upperGarmentKey: input.upperGarmentKey,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { workflowTemplateId: input.workflowTemplateId },
    });

    // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the merchant ledger helper.
    await atomicMerchantDeduct(tx as any, input.merchantId, input.cost, jobId);
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'type',
    'KIOSK_TRYON',
  );

  return jobId;
}
