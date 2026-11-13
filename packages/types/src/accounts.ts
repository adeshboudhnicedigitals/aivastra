import { z } from 'zod';

// Account console (docs/superpowers/specs/2026-11-12-merchant-web-account-console-design.md §5).

export const AccountListQuery = z.object({
  search: z.string().trim().max(80).optional(),
  active: z.enum(['true', 'false']).optional(),
  sort: z.enum(['company', 'balance', 'burn', 'activity']).default('company'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AccountListQuery = z.infer<typeof AccountListQuery>;

export interface AccountRow {
  merchantId: string;
  companyName: string;
  ownerEmail: string;
  isActive: boolean;
  createdAt: string;
  creditBalance: number;
  /** Credits used by completed jobs in the last 30 days. */
  burn30d: number;
  branches: number;
  /** Paired, active tablets. */
  devices: number;
  /** Paired, active tablets not seen for 7 days (or never). */
  devicesOffline: number;
  lastActivityAt: string | null;
  channels: { inStore: boolean; shopify: boolean; apiKey: boolean };
}

export interface AccountListResponse {
  items: AccountRow[];
  total: number;
  page: number;
  limit: number;
}
