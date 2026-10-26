import { describe, expect, it } from 'vitest';
import { classifySourceJob, type SourceJobShape } from '../src/modules/comparison/eligibility.js';

function directJob(): SourceJobShape {
  return {
    source: 'tryon',
    status: 'COMPLETED',
    merchantId: null,
    shopifyStoreId: null,
    customerPhotoKey: null,
    resultKey: 'results/source.webp',
    templateId: 'original-template',
    inputs: {
      upperGarmentKey: 'uploads/garment.webp',
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { personKey: 'uploads/person.webp' },
    },
  };
}

describe('classifySourceJob', () => {
  it('extracts the real person and garment keys from a direct try-on', () => {
    expect(classifySourceJob(directJob(), 'general')).toEqual({
      eligible: true,
      personKey: 'uploads/person.webp',
      garmentKey: 'uploads/garment.webp',
    });
  });

  it.each([
    ['QUEUED'],
    ['RUNNING'],
    ['FAILED'],
    ['CANCELLED'],
  ])('rejects status %s before looking for images', (status) => {
    expect(classifySourceJob({ ...directJob(), status, resultKey: null }, 'general')).toEqual({
      eligible: false,
      reason: 'NOT_COMPLETED',
    });
  });

  it.each([null, '', '   '])('rejects missing result %j', (resultKey) => {
    expect(classifySourceJob({ ...directJob(), resultKey }, 'general')).toEqual({
      eligible: false,
      reason: 'NO_RESULT',
    });
  });

  it('rejects comparison replays', () => {
    expect(classifySourceJob({ ...directJob(), source: 'comparison' }, 'general')).toEqual({
      eligible: false,
      reason: 'IS_COMPARISON',
    });
  });

  it('rejects jobs already using the target template', () => {
    expect(classifySourceJob({ ...directJob(), templateId: 'general' }, 'general')).toEqual({
      eligible: false,
      reason: 'ALREADY_GENERAL',
    });
  });

  it.each(['faceId', 'backgroundId', 'poseId'] as const)('rejects model input %s', (field) => {
    const job = directJob();
    job.inputs[field] = 'model-id';
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'FACE_POSE_BG_JOB',
    });
  });

  it.each([
    'video',
    'regenerate',
    'fabric_to_garment',
    'saree_mannequin',
    'shopify',
  ])('rejects unsupported direct kind %s even with a person key', (kind) => {
    const job = directJob();
    job.inputs.params = { kind, personKey: 'uploads/person.webp' };
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NON_TRYON_KIND',
    });
  });

  it.each([null, '', ' \t '])('rejects missing direct person %j', (personKey) => {
    const job = directJob();
    job.inputs.params = { personKey };
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NO_PERSON_IMAGE',
    });
  });

  it.each([null, '', ' \n '])('rejects missing garment %j', (upperGarmentKey) => {
    const job = directJob();
    job.inputs.upperGarmentKey = upperGarmentKey;
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NO_GARMENT_IMAGE',
    });
  });

  it.each(['merchant', 'shopify'])('accepts real %s widget input columns', (owner) => {
    const job = directJob();
    job.merchantId = owner === 'merchant' ? 'merchant-id' : null;
    job.shopifyStoreId = owner === 'shopify' ? 'store-id' : null;
    job.customerPhotoKey = 'uploads/customer.webp';
    job.inputs.params = owner === 'shopify' ? { kind: 'shopify' } : null;
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: true,
      personKey: 'uploads/customer.webp',
      garmentKey: 'uploads/garment.webp',
    });
  });

  it('uses the widget customer photo even if params contains a different person key', () => {
    const job = directJob();
    job.merchantId = 'merchant-id';
    job.customerPhotoKey = 'uploads/customer.webp';
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: true,
      personKey: 'uploads/customer.webp',
      garmentKey: 'uploads/garment.webp',
    });
  });

  it('does not substitute a stale params person for a missing widget customer photo', () => {
    const job = directJob();
    job.shopifyStoreId = 'store-id';
    job.inputs.params = { kind: 'shopify', personKey: 'uploads/stale.webp' };
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NO_PERSON_IMAGE',
    });
  });

  it('rejects a saree-derived final try-on', () => {
    const job = directJob();
    job.merchantId = 'merchant-id';
    job.customerPhotoKey = 'uploads/customer.webp';
    job.inputs.params = { mannequinJobId: 'mannequin-id' };
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NON_TRYON_KIND',
    });
  });

  it('rejects a collected source after person erasure even if image pointers remain', () => {
    const job = directJob();
    job.inputs.params = { comparisonErased: true, personKey: 'uploads/person.webp' };
    expect(classifySourceJob(job, 'general')).toEqual({ eligible: false, reason: 'SOURCE_ERASED' });
  });

  it('accepts historical stringified params', () => {
    const job = directJob();
    job.inputs.params = '{"personKey":"uploads/historical.webp"}';
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: true,
      personKey: 'uploads/historical.webp',
      garmentKey: 'uploads/garment.webp',
    });
  });

  it.each(['{broken', 'null', '[]', '42'])('fails closed on malformed params %s', (params) => {
    const job = directJob();
    job.inputs.params = params;
    expect(classifySourceJob(job, 'general')).toEqual({
      eligible: false,
      reason: 'NO_PERSON_IMAGE',
    });
  });
});
