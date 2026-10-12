import { describe, expect, it } from 'vitest';
import {
  AdminRejectRefundBody,
  CreateRefundRequestBody,
  DEFAULT_REFUND_AUTO_APPROVE_CONFIG,
  fillRefundAutoApproveDefaults,
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
  RefundAutoApprovePatch,
} from './refund.js';

describe('refund schemas', () => {
  it('has a label for every reason code', () => {
    for (const code of REFUND_REASON_CODES) {
      expect(REFUND_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it('accepts a valid request and trims the note', () => {
    const parsed = CreateRefundRequestBody.parse({ reasonCode: 'FACE_MISMATCH', note: '  off  ' });
    expect(parsed.note).toBe('off');
  });

  it('rejects an unknown reason code and an over-long note', () => {
    expect(CreateRefundRequestBody.safeParse({ reasonCode: 'NOPE' }).success).toBe(false);
    expect(
      CreateRefundRequestBody.safeParse({ reasonCode: 'OTHER', note: 'x'.repeat(301) }).success,
    ).toBe(false);
  });

  it('requires an admin note of at least 3 characters to reject', () => {
    expect(AdminRejectRefundBody.safeParse({ adminNote: 'no' }).success).toBe(false);
    expect(AdminRejectRefundBody.safeParse({ adminNote: 'Looks fine to us' }).success).toBe(true);
  });
});

describe('fillRefundAutoApproveDefaults', () => {
  it('returns fail-safe defaults for undefined, empty, and garbage input', () => {
    expect(fillRefundAutoApproveDefaults(undefined)).toEqual(DEFAULT_REFUND_AUTO_APPROVE_CONFIG);
    expect(fillRefundAutoApproveDefaults({})).toEqual(DEFAULT_REFUND_AUTO_APPROVE_CONFIG);
    expect(fillRefundAutoApproveDefaults(null)).toEqual(DEFAULT_REFUND_AUTO_APPROVE_CONFIG);
    expect(fillRefundAutoApproveDefaults('not json')).toEqual(DEFAULT_REFUND_AUTO_APPROVE_CONFIG);
    expect(fillRefundAutoApproveDefaults(42)).toEqual(DEFAULT_REFUND_AUTO_APPROVE_CONFIG);
    expect(fillRefundAutoApproveDefaults([{ enabled: true }])).toEqual(
      DEFAULT_REFUND_AUTO_APPROVE_CONFIG,
    );
  });

  it('falls back per field, keeping a good sibling when the other is bad', () => {
    expect(fillRefundAutoApproveDefaults({ enabled: true, dailyCap: 'lots' })).toEqual({
      enabled: true,
      dailyCap: 5,
    });
    expect(fillRefundAutoApproveDefaults({ enabled: 'yes', dailyCap: 10 })).toEqual({
      enabled: false,
      dailyCap: 10,
    });
  });

  it('accepts a fully valid stored shape', () => {
    expect(fillRefundAutoApproveDefaults({ enabled: true, dailyCap: 10 })).toEqual({
      enabled: true,
      dailyCap: 10,
    });
  });

  it('RefundAutoApprovePatch rejects dailyCap 0 and 101', () => {
    expect(RefundAutoApprovePatch.safeParse({ dailyCap: 0 }).success).toBe(false);
    expect(RefundAutoApprovePatch.safeParse({ dailyCap: 101 }).success).toBe(false);
    expect(RefundAutoApprovePatch.safeParse({}).success).toBe(true);
    expect(RefundAutoApprovePatch.safeParse({ enabled: true }).success).toBe(true);
  });
});
