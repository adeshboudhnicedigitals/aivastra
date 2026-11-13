import { z } from 'zod';

// CRM phase 2 (docs/superpowers/plans/2026-11-12-crm-identification-mode-a.md).

const digits = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, 'must be digits');

/** Manual connect of the brand's own WhatsApp Business number (spec §4.1 A2). */
export const WhatsappChannelPutBody = z.object({
  wabaId: digits,
  phoneNumberId: digits,
  accessToken: z.string().trim().min(20).max(1024),
  appSecret: z.string().trim().min(16).max(256),
});
export type WhatsappChannelPutBody = z.infer<typeof WhatsappChannelPutBody>;

/** Never carries the token or app secret. */
export interface WhatsappChannelResponse {
  connected: boolean;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayNumber: string | null;
  connectedAt: string | null;
}

export const PHOTO_RETENTION_DAYS = { min: 1, max: 365 } as const;
export const PROFILE_RETENTION_DAYS = { min: 30, max: 1095 } as const;

export const CrmSettingsPutBody = z.object({
  identifyAt: z.enum(['end', 'start']),
  photoRetentionDays: z.number().int().min(PHOTO_RETENTION_DAYS.min).max(PHOTO_RETENTION_DAYS.max),
  profileRetentionDays: z
    .number()
    .int()
    .min(PROFILE_RETENTION_DAYS.min)
    .max(PROFILE_RETENTION_DAYS.max),
});
export type CrmSettingsPutBody = z.infer<typeof CrmSettingsPutBody>;

/** What still stands between this merchant and shopper identification (plan C2, C3). */
export type IdentifyBlocker = 'feature_off' | 'no_channel' | 'no_retention';

export interface CrmSettingsResponse {
  identifyAt: 'end' | 'start';
  photoRetentionDays: number | null;
  profileRetentionDays: number | null;
  identification: { enabled: boolean; blockers: IdentifyBlocker[] };
}

/** Tablet: start of "Get these looks on WhatsApp" (spec §5, §4.1 A1). */
export interface IdentifyStartResponse {
  code: string;
  /** wa.me link to the brand's number with `LOOKS <code>` prefilled; shown as a QR. */
  waLink: string;
  expiresAt: string;
}

export interface IdentifyStatusResponse {
  status: 'pending' | 'verified' | 'expired';
}
