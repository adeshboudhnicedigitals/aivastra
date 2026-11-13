import { z } from 'zod';
import { AnalyticsQuery, type AnalyticsWindow } from './merchant-analytics.js';

// Merchant Insights (docs/superpowers/plans/2026-11-13-merchant-insights-screen.md). Same
// window, scope and metric definitions as the dashboard; staff are forced to their own branch
// server-side. The lists are per item, never per person.
export const InsightsQuery = AnalyticsQuery.pick({
  from: true,
  to: true,
  tz: true,
  branchId: true,
});
export type InsightsQuery = z.infer<typeof InsightsQuery>;

export const LOST_DEMAND_MIN_TRIES_DEFAULT = 5;
export const STALE_STOCK_DAYS_DEFAULT = 14;
export const INSIGHTS_LIST_MAX = 20;

export const LostDemandQuery = InsightsQuery.extend({
  /** An item needs at least this many tries to be listed, so one try never makes a "0% item". */
  minTries: z.coerce.number().int().min(1).max(1000).default(LOST_DEMAND_MIN_TRIES_DEFAULT),
});
export type LostDemandQuery = z.infer<typeof LostDemandQuery>;

export const OutOfStockQuery = InsightsQuery.extend({
  staleDays: z.coerce.number().int().min(1).max(365).default(STALE_STOCK_DAYS_DEFAULT),
});
export type OutOfStockQuery = z.infer<typeof OutOfStockQuery>;

export interface InsightsFunnelResponse {
  window: AnalyticsWindow;
  /** Sessions that reached each step, by the session's started_at. */
  sessions: number;
  tried: number;
  carted: number;
  billed: number;
  /** Carts that hold at least one line. `open` ones are under 24h old and not yet judged. */
  carts: { billed: number; abandoned: number; open: number };
  /** abandoned ÷ (billed + abandoned); null when no cart has been decided yet. */
  abandonmentRate: number | null;
}

export interface LostDemandItem {
  catalogItemId: string;
  name: string;
  pricePaise: number | null;
  tried: number;
  /** Units added to a cart and not removed. */
  carted: number;
  /** Units sold, voids excluded. */
  sold: number;
  /** sold ÷ tried, capped at 1. */
  rate: number;
}

export interface DemandByVariant {
  /** The size or colour; an empty colour means the variant has none. */
  label: string;
  carted: number;
  sold: number;
}

export interface LostDemandResponse {
  window: AnalyticsWindow;
  minTries: number;
  items: LostDemandItem[];
  /** From cart lines only: a try-on records no size, so size/colour demand starts at the cart. */
  bySize: DemandByVariant[];
  byColour: DemandByVariant[];
}

export interface OutOfStockRow {
  catalogItemId: string | null;
  name: string;
  size: string;
  colour: string;
  branchId: string | null;
  branchName: string;
  /** Server-counted cart adds refused as out of stock (cannot be forged by a tablet). */
  refused: number;
  /** Times the tablet reported the out-of-stock size on screen (device-reported, advisory). */
  views: number;
}

export interface StaleStockBranch {
  branchId: string;
  branchName: string;
  variants: number;
  lastUpdate: string;
}

export interface OutOfStockResponse {
  window: AnalyticsWindow;
  staleDays: number;
  rows: OutOfStockRow[];
  stale: StaleStockBranch[];
}

export interface InsightsReliabilityResponse {
  window: AnalyticsWindow;
  /** Session-attributed jobs that reached COMPLETED or FAILED. */
  finished: number;
  failed: number;
  failureRate: number | null;
  /** completed_at − created_at on completed jobs; null with none. */
  waitMs: { p50: number | null; p90: number | null };
  /** Credits spent (net of refunds) ÷ try-ons / ÷ units sold; null when the divisor is 0. */
  creditsPerTryon: number | null;
  creditsPerSale: number | null;
}
