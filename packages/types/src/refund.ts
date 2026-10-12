import { z } from 'zod';

export const REFUND_REASON_CODES = [
  'WRONG_GARMENT',
  'DISTORTED_BODY',
  'FACE_MISMATCH',
  'BACKGROUND_OR_POSE',
  'POOR_QUALITY',
  'OTHER',
] as const;
export const RefundReasonCode = z.enum(REFUND_REASON_CODES);
export type RefundReasonCode = z.infer<typeof RefundReasonCode>;

export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  WRONG_GARMENT: 'Wrong garment or colour',
  DISTORTED_BODY: 'Distorted body or hands',
  FACE_MISMATCH: 'Face does not match',
  BACKGROUND_OR_POSE: 'Background or pose issue',
  POOR_QUALITY: 'Poor image quality',
  OTHER: 'Other',
};

export const RefundStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type RefundStatus = z.infer<typeof RefundStatus>;

export const CreateRefundRequestBody = z.object({
  reasonCode: RefundReasonCode,
  note: z.string().trim().max(300).optional(),
});
export type CreateRefundRequestBody = z.infer<typeof CreateRefundRequestBody>;

export const AdminApproveRefundBody = z.object({
  adminNote: z.string().trim().max(500).optional(),
});
export type AdminApproveRefundBody = z.infer<typeof AdminApproveRefundBody>;

export const AdminRejectRefundBody = z.object({
  adminNote: z.string().trim().min(3).max(500),
});
export type AdminRejectRefundBody = z.infer<typeof AdminRejectRefundBody>;

export const RefundAutoApproveConfig = z.object({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(1).max(100),
});
export type RefundAutoApproveConfig = z.infer<typeof RefundAutoApproveConfig>;

export const RefundAutoApprovePatch = RefundAutoApproveConfig.partial();
export type RefundAutoApprovePatch = z.infer<typeof RefundAutoApprovePatch>;

// Off by default — shipping this changes no behaviour until an admin flips it.
export const DEFAULT_REFUND_AUTO_APPROVE_CONFIG: RefundAutoApproveConfig = {
  enabled: false,
  dailyCap: 5,
};

// Validates each field independently so one bad field falls back to its
// default while keeping a good sibling (flat shape — no per-key loop needed).
export function fillRefundAutoApproveDefaults(stored: unknown): RefundAutoApproveConfig {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return { ...DEFAULT_REFUND_AUTO_APPROVE_CONFIG };
  }
  const s = stored as Record<string, unknown>;
  return {
    enabled:
      typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_REFUND_AUTO_APPROVE_CONFIG.enabled,
    dailyCap:
      typeof s.dailyCap === 'number' &&
      Number.isInteger(s.dailyCap) &&
      s.dailyCap >= 1 &&
      s.dailyCap <= 100
        ? s.dailyCap
        : DEFAULT_REFUND_AUTO_APPROVE_CONFIG.dailyCap,
  };
}
