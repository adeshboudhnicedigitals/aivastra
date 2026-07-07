import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { atomicWidgetDeduct } from './ledger.js';

export const WIDGET_JOB_COST = 10;

interface CreateWidgetStyleJobInput {
  widgetClientId: string;
  kioskDeviceId?: string;
  upperGarmentKey: string;
  customerPhotoKey: string;
  cost: number;
}

export async function createWidgetStyleJob(
  app: FastifyInstance,
  input: CreateWidgetStyleJobInput,
): Promise<string> {
  const jobId = randomUUID();

  await app.db.transaction(async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId/FK cols as non-null; widget-style jobs legitimately have null userId and null face/bg/pose.
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: null,
      widgetClientId: input.widgetClientId,
      kioskDeviceId: input.kioskDeviceId ?? null,
      customerPhotoKey: input.customerPhotoKey,
      status: 'QUEUED',
      creditsCharged: input.cost,
    });

    // biome-ignore lint/suspicious/noExplicitAny: same - face/bg/pose are nullable in SQL but Drizzle types them non-null.
    await (tx.insert(schema.jobInputs).values as any)({
      jobId,
      upperGarmentKey: input.upperGarmentKey,
      faceId: null,
      backgroundId: null,
      poseId: null,
    });

    // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the widget ledger helper.
    await atomicWidgetDeduct(tx as any, input.widgetClientId, input.cost, jobId);
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
    'WIDGET_TRYON',
  );

  return jobId;
}
