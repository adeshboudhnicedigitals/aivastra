import { describe, expect, it } from 'vitest';
import { classifyJobFailure, jobRef, requestRef } from '../src/modules/shopify/failure.js';

describe('shopify shopper-facing failure classification', () => {
  it('maps photo, capacity and everything else', () => {
    expect(classifyJobFailure('NO_FACE_IMAGE')).toBe('PHOTO');
    expect(classifyJobFailure('NO_WORKER')).toBe('BUSY');
    expect(classifyJobFailure('WORKFLOW_NOT_FOUND')).toBe('SERVICE');
    expect(classifyJobFailure('some provider exception text')).toBe('SERVICE');
    expect(classifyJobFailure(null)).toBe('SERVICE');
  });

  it('derives short upper-case references', () => {
    expect(jobRef('3f2a9c1e-1111-2222-3333-444455556666')).toBe('3F2A9C1E');
    expect(requestRef()).toMatch(/^[0-9A-F]{8}$/);
  });
});
