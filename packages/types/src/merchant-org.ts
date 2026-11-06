import { z } from 'zod';

export const MerchantBranchCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
});
export type MerchantBranchCreateBody = z.infer<typeof MerchantBranchCreateBody>;

export const MerchantBranchUpdateBody = MerchantBranchCreateBody.partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });
export type MerchantBranchUpdateBody = z.infer<typeof MerchantBranchUpdateBody>;

export const MerchantStaffCreateBody = z.object({
  branchId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(120),
});
export type MerchantStaffCreateBody = z.infer<typeof MerchantStaffCreateBody>;

export const MerchantStaffUpdateBody = z
  .object({ isActive: z.boolean().optional(), branchId: z.string().uuid().optional() })
  .refine((b) => b.isActive !== undefined || b.branchId !== undefined, {
    message: 'at least one field is required',
  });
export type MerchantStaffUpdateBody = z.infer<typeof MerchantStaffUpdateBody>;

// AiVastra admin uses the same shapes — kept as named aliases so the admin
// routes read clearly and can diverge later without touching merchant routes.
export const AdminMerchantBranchUpdateBody = MerchantBranchUpdateBody;
export const AdminMerchantStaffUpdateBody = MerchantStaffUpdateBody;
