import { z } from 'zod';

// v1.0 step 3c (docs/superpowers/specs/2026-11-06-v1-merchant-web-dashboards-design.md).
// Read-only Merchant Web analytics. `from`/`to` are inclusive calendar dates interpreted in
// `tz`; range/ordering/tz validity are checked server-side in parseWindow (they need "now"
// and the tz database), so the schema only guards the shape.
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const AnalyticsQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  tz: z.string().min(1).max(64).optional(),
  branchId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export interface AnalyticsWindow {
  from: string;
  to: string;
  tz: string;
}

export interface AnalyticsConversion {
  sold: number;
  sessions: number;
  /** sold ÷ sessions; 0 when there are no sessions (never NaN). */
  ratio: number;
}

export interface AnalyticsSummaryResponse {
  window: AnalyticsWindow;
  sessions: number;
  tried: number;
  sold: number;
  wishlisted: number;
  conversion: AnalyticsConversion;
  /** In-store (session-attributed) credits charged in the window. */
  creditsSpent: number;
  /** Merchant owner's wallet; null for staff callers (a merchant-wide figure). */
  creditsBalance: number | null;
  lowCreditThreshold: number;
  lowCredit: boolean;
  /** Legacy kiosk / other jobs (no session); null for staff callers. */
  unattributed: { jobs: number; credits: number } | null;
  /** Present only for staff callers: rows attributed to the caller. */
  mine?: { sessions: number; tried: number; sold: number };
}
