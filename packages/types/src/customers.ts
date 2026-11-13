import { z } from 'zod';

// CRM phase 4 (docs/superpowers/plans/2026-11-12-crm-phase4-customer-screens.md). One filter
// language for the list, saved segments and export (decision K3).

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CustomerFilters = z.object({
  /** Name, or a phone number (matched exactly through the lookup hash, never by scanning). */
  q: z.string().trim().max(80).optional(),
  branchId: z.string().uuid().optional(),
  marketing: z.enum(['yes', 'no', 'any']).default('any'),
  lastVisitFrom: LocalDate.optional(),
  lastVisitTo: LocalDate.optional(),
  minVisits: z.coerce.number().int().min(1).max(1000).optional(),
});
export type CustomerFilters = z.infer<typeof CustomerFilters>;

export const CustomerListQuery = CustomerFilters.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque, from the previous page's nextCursor. */
  cursor: z.string().max(200).optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

export interface CustomerRow {
  id: string;
  name: string | null;
  /** Masked in lists (decision K2), e.g. +91 98•••••210. */
  phone: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visits: number;
  tryOns: number;
  purchases: number;
  branchIds: string[];
  consents: { looks: boolean | null; marketing: boolean | null };
}

export interface CustomerListResponse {
  items: CustomerRow[];
  nextCursor: string | null;
}

export interface CustomerProfile extends Omit<CustomerRow, 'phone'> {
  /** Full number; viewing it is audited. */
  phone: string;
  visitsList: Array<{
    sessionId: string;
    startedAt: string;
    branchId: string;
    branchName: string;
    mode: string;
    tried: number;
    sold: number;
  }>;
  consentHistory: Array<{
    kind: string;
    granted: boolean;
    version: string;
    source: string;
    at: string;
  }>;
}

export const SegmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  filters: CustomerFilters,
});
export type SegmentBody = z.infer<typeof SegmentBody>;
