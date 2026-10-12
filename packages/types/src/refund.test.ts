import { describe, expect, it } from 'vitest';
import {
  AdminRejectRefundBody,
  CreateRefundRequestBody,
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
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
