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
