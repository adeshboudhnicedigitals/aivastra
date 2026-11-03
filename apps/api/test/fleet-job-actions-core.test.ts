import { describe, expect, it } from 'vitest';
import { cancelBlock, retryBlock, retryStream } from '../src/modules/fleet/job-actions-core';

const job = (over = {}) => ({
  status: 'QUEUED',
  source: 'tryon',
  userId: 'u1',
  shopifyStoreId: null,
  ...over,
});

describe('cancelBlock', () => {
  it('allows a queued customer job', () => expect(cancelBlock(job())).toBeNull());
  it.each([
    'PREPROCESSING',
    'GENERATING',
    'UPLOADING',
    'COMPLETED',
    'FAILED',
    'HELD',
  ])('refuses %s', (status) => expect(cancelBlock(job({ status }))).toMatch(/Only a queued job/));
  it('says when it is already cancelled', () =>
    expect(cancelBlock(job({ status: 'CANCELLED' }))).toMatch(/already cancelled/));
  it('leaves store-billed and account-less jobs to the admin panel', () => {
    expect(cancelBlock(job({ shopifyStoreId: 's1' }))).toMatch(/Shopify/);
    expect(cancelBlock(job({ userId: null }))).toMatch(/no customer account/);
  });
});

describe('retryBlock', () => {
  it('allows a failed job', () => expect(retryBlock(job({ status: 'FAILED' }))).toBeNull());
  it.each(['QUEUED', 'GENERATING', 'COMPLETED', 'CANCELLED'])('refuses %s', (status) =>
    expect(retryBlock(job({ status }))).toMatch(/Only a failed job/));
  it('refuses comparison and store-billed jobs', () => {
    expect(retryBlock(job({ status: 'FAILED', source: 'comparison' }))).toMatch(/Comparison/);
    expect(retryBlock(job({ status: 'FAILED', shopifyStoreId: 's1' }))).toMatch(/Shopify/);
  });
});

describe('retryStream', () => {
  it('uses the job lane, else priority or normal', () => {
    expect(retryStream({ queueStream: 'video', priority: false })).toBe('jobs:video');
    expect(retryStream({ queueStream: null, priority: true })).toBe('jobs:priority');
    expect(retryStream({ queueStream: null, priority: false })).toBe('jobs:normal');
  });
});
