import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import {
  createMerchantTryonJob,
  createMerchantTryonJobTwoStep,
  type JobAttribution,
} from './create-tryon-job.js';
import { resolveTryonGarment } from './resolve-tryon-garment.js';

/**
 * The customer photo must be an upload this merchant presigned (key prefix + the
 * redis owner record), still present in storage, and within the size ceiling.
 */
export async function assertOwnedCustomerPhoto(
  app: FastifyInstance,
  merchantId: string,
  customerPhotoKey: string,
) {
  if (!customerPhotoKey.startsWith(keys.merchantInputPrefix(merchantId))) {
    throw new AppError('FORBIDDEN', 403, 'customer photo key does not belong to this merchant');
  }

  const uploadOwner = await app.redis.get(`upload:owner:${customerPhotoKey}`);
  if (uploadOwner !== merchantId) {
    throw new AppError('FORBIDDEN', 403, 'upload session expired or not owned');
  }

  let photoHead: { contentLength: number };
  try {
    photoHead = await app.storage.headObject(customerPhotoKey);
  } catch {
    throw new AppError('BAD_UPLOAD', 400, 'uploaded photo not found');
  }
  const maxTryonBytes = await getUploadLimitBytes(app, 'merchantTryonMaxBytes');
  if (photoHead.contentLength > maxTryonBytes) {
    throw new AppError(
      'BAD_UPLOAD',
      413,
      `uploaded photo exceeds ${maxTryonBytes / (1024 * 1024)}MB limit`,
    );
  }
}

/**
 * The garment try-on body of POST /v1/merchant/tryon/jobs, extracted so the device route
 * can reuse it. With no `attribution` it is exactly the previous inline behaviour.
 */
export async function createGarmentTryonJob(
  app: FastifyInstance,
  merchantId: string,
  input: { merchantCatalogItemId: string; customerPhotoKey: string },
  attribution?: JobAttribution,
): Promise<{ jobId: string }> {
  const { merchantCatalogItemId, customerPhotoKey } = input;
  const garment = await resolveTryonGarment(app, merchantId, merchantCatalogItemId);

  await assertOwnedCustomerPhoto(app, merchantId, customerPhotoKey);

  const [merchant] = await app.db
    .select({ userId: schema.merchants.userId })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!merchant) throw new AppError('NOT_FOUND', 404, 'merchant not found');

  const jobId =
    garment.kind === 'two-input'
      ? await createMerchantTryonJobTwoStep(app, {
          merchantId,
          merchantUserId: merchant.userId,
          customerPhotoKey,
          bodyKey: garment.bodyKey,
          palluKey: garment.palluKey,
          garmentSubcategoryId: garment.garmentSubcategoryId,
          merchantCatalogItemId,
          mannequinWorkflowTemplateId: garment.mannequinWorkflowTemplateId,
          mannequinWorkflowTemplateVersion: garment.mannequinWorkflowTemplateVersion,
          tryonWorkflowTemplateId: garment.tryonWorkflowTemplateId,
          tryonWorkflowTemplateVersion: garment.tryonWorkflowTemplateVersion,
          attribution,
        })
      : await createMerchantTryonJob(app, {
          merchantId,
          merchantUserId: merchant.userId,
          upperGarmentKey: garment.r2Key,
          customerPhotoKey,
          workflowTemplateId: garment.workflowTemplateId,
          dispatchTemplateVersion: garment.workflowTemplateVersion ?? null,
          attribution,
        });

  return { jobId };
}
