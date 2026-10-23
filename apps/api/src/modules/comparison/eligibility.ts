import { JOB_SOURCE } from '@aivastra/types';

export type SourceJobShape = {
  source: string | null;
  status: string;
  merchantId: string | null;
  shopifyStoreId: string | null;
  customerPhotoKey: string | null;
  resultKey: string | null;
  templateId: string | null;
  inputs: {
    upperGarmentKey: string | null;
    faceId: string | null;
    backgroundId: string | null;
    poseId: string | null;
    // Dispatcher also accepts historical rows whose JSONB value is a JSON string.
    params: Record<string, unknown> | string | null;
  };
};

export const COMPARISON_UNSUPPORTED_REASONS = [
  'NOT_COMPLETED',
  'NO_RESULT',
  'IS_COMPARISON',
  'ALREADY_GENERAL',
  'FACE_POSE_BG_JOB',
  'NON_TRYON_KIND',
  'NO_PERSON_IMAGE',
  'NO_GARMENT_IMAGE',
  'SOURCE_ERASED',
] as const;

export type ComparisonUnsupportedReason = (typeof COMPARISON_UNSUPPORTED_REASONS)[number];
export type Eligibility =
  | { eligible: true; personKey: string; garmentKey: string }
  | { eligible: false; reason: ComparisonUnsupportedReason };

export function classifySourceJob(job: SourceJobShape, generalTemplateId: string): Eligibility {
  if (job.status !== 'COMPLETED') return { eligible: false, reason: 'NOT_COMPLETED' };
  if (!imageKey(job.resultKey)) return { eligible: false, reason: 'NO_RESULT' };
  if (job.source === JOB_SOURCE.COMPARISON) return { eligible: false, reason: 'IS_COMPARISON' };

  const params = readParams(job.inputs.params);
  if (params.comparisonErased === true) return { eligible: false, reason: 'SOURCE_ERASED' };
  if (job.templateId === generalTemplateId) return { eligible: false, reason: 'ALREADY_GENERAL' };
  if (job.inputs.faceId || job.inputs.backgroundId || job.inputs.poseId) {
    return { eligible: false, reason: 'FACE_POSE_BG_JOB' };
  }

  // Merchant create-tryon-job and Shopify customer.routes store the person in
  // jobs.customerPhotoKey and garment in job_inputs.upperGarmentKey. Dispatcher
  // routes these owner-shaped widgets before direct kinds; only store-owned
  // Shopify widgets may use kind=shopify (a direct kind=shopify is unsupported).
  const isWidget = Boolean(job.merchantId || job.shopifyStoreId);
  const isShopifyWidget = Boolean(job.shopifyStoreId) && params.kind === 'shopify';
  if ((params.kind != null && !isShopifyWidget) || params.mannequinJobId != null) {
    return { eligible: false, reason: 'NON_TRYON_KIND' };
  }

  const personKey = isWidget
    ? imageKey(job.customerPhotoKey)
    : (imageKey(params.personKey) ?? imageKey(job.customerPhotoKey));
  if (!personKey) return { eligible: false, reason: 'NO_PERSON_IMAGE' };
  const garmentKey = imageKey(job.inputs.upperGarmentKey);
  if (!garmentKey) return { eligible: false, reason: 'NO_GARMENT_IMAGE' };
  return { eligible: true, personKey, garmentKey };
}

function imageKey(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readParams(raw: SourceJobShape['inputs']['params']): Record<string, unknown> {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
