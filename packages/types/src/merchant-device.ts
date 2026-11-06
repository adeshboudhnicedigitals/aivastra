import { z } from 'zod';

const name = z.string().trim().min(1).max(80);

export const MerchantDeviceCreateBody = z.object({ branchId: z.string().uuid(), name });
export type MerchantDeviceCreateBody = z.infer<typeof MerchantDeviceCreateBody>;

export const MerchantDeviceUpdateBody = z
  .object({
    name: name.optional(),
    branchId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no fields to update');
export type MerchantDeviceUpdateBody = z.infer<typeof MerchantDeviceUpdateBody>;

export const AdminMerchantDeviceUpdateBody = MerchantDeviceUpdateBody;
export type AdminMerchantDeviceUpdateBody = MerchantDeviceUpdateBody;

export const DevicePairBody = z.object({ code: z.string().trim().toUpperCase().min(6).max(16) });
export type DevicePairBody = z.infer<typeof DevicePairBody>;

export const DeviceSessionCreateBody = z.object({ mode: z.enum(['kiosk', 'assisted']) });
export type DeviceSessionCreateBody = z.infer<typeof DeviceSessionCreateBody>;

export const DeviceSessionItemBody = z.object({
  catalogItemId: z.string().uuid(),
  action: z.enum(['wishlisted', 'sold']),
});
export type DeviceSessionItemBody = z.infer<typeof DeviceSessionItemBody>;

export const DeviceTryonJobBody = z.object({
  sessionId: z.string().uuid(),
  merchantCatalogItemId: z.string().uuid(),
  customerPhotoKey: z.string().min(1),
});
export type DeviceTryonJobBody = z.infer<typeof DeviceTryonJobBody>;
