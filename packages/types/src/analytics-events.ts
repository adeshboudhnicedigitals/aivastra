import { z } from 'zod';
import { AnalyticsQuery } from './merchant-analytics.js';

// Analytics phase 1 (docs/superpowers/plans/2026-11-12-analytics-events-foundation.md).
// The event catalogue, split by who may write each name. The split IS the trust boundary:
// a client can only report what it saw (a view, a click); everything that records a fact the
// business counts (a session, a sale, a void) is written by the API in the same transaction
// as the source row, so a tablet cannot forge it. Names are validated here rather than as a
// Postgres enum so later phases (CRM, cart, inventory, POS) add a name, not a migration.

/** Written by the API only, alongside the source write. */
export const ANALYTICS_SERVER_EVENTS = [
  'session_started',
  'session_ended',
  'tryon_requested',
  'item_wishlisted',
  'sale_recorded',
  'sale_voided',
  // CRM phase 2: a shopper sent LOOKS <code> from their phone; their consent answer; looks sent.
  'shopper_identified',
  'consent_recorded',
  'looks_sent',
  // CRM phase 3: cart lines added/removed on the tablet. A billed line is a sale_recorded.
  'cart_added',
  'cart_removed',
  // A cart add refused because the size is out at the branch: the server-side out-of-stock demand number.
  'cart_refused_oos',
] as const;
export type AnalyticsServerEvent = (typeof ANALYTICS_SERVER_EVENTS)[number];

/**
 * Never stored in analytics_events: the rollup derives them from `jobs` (plan decision D1),
 * so the dispatcher's settlement transaction carries no analytics write.
 */
export const ANALYTICS_DERIVED_EVENTS = ['tryon_completed', 'tryon_failed'] as const;
export type AnalyticsDerivedEvent = (typeof ANALYTICS_DERIVED_EVENTS)[number];

/**
 * What a paired device may report through POST /v1/device/events. Forgeable by nature
 * (the device says it happened), so never counted as a sale, a try-on or a session.
 */
export const ANALYTICS_CLIENT_EVENTS = [
  'item_viewed',
  'category_viewed',
  'identify_shown',
  'qr_shown',
  'qr_scanned',
  'buy_online_click',
  'oos_viewed',
  'other_branch_shown',
] as const;
export const AnalyticsClientEvent = z.enum(ANALYTICS_CLIENT_EVENTS);
export type AnalyticsClientEvent = z.infer<typeof AnalyticsClientEvent>;

/** Every name that may appear in analytics_events or analytics_buckets. */
export type AnalyticsEventName =
  | AnalyticsServerEvent
  | AnalyticsDerivedEvent
  | AnalyticsClientEvent;

export const ANALYTICS_EVENT_PROPS_MAX_KEYS = 20;
export const ANALYTICS_EVENT_PROP_MAX_LEN = 200;
export const DEVICE_EVENTS_BATCH_MAX = 100;

// Flat scalars only: props are for slicing ("which category", "which wait time"), not for
// shipping documents, and a bounded shape keeps a misbehaving device from bloating the table.
const PropValue = z.union([
  z.string().max(ANALYTICS_EVENT_PROP_MAX_LEN),
  z.number().finite(),
  z.boolean(),
]);
const PropKey = z.string().min(1).max(64);

export const AnalyticsEventProps = z
  .record(PropKey, PropValue)
  .refine((p) => Object.keys(p).length <= ANALYTICS_EVENT_PROPS_MAX_KEYS, {
    message: `at most ${ANALYTICS_EVENT_PROPS_MAX_KEYS} props`,
  });
export type AnalyticsEventProps = z.infer<typeof AnalyticsEventProps>;

export const DeviceEvent = z.object({
  /** Client-generated; the dedupe key per device, so a retry or offline replay is a no-op. */
  id: z.string().uuid(),
  event: AnalyticsClientEvent,
  /** Device clock. The server clamps future skew and drops events older than 7 days. */
  occurredAt: z.string().datetime({ offset: true }),
  sessionId: z.string().uuid().optional(),
  catalogItemId: z.string().uuid().optional(),
  props: AnalyticsEventProps.optional(),
});
export type DeviceEvent = z.infer<typeof DeviceEvent>;

// No merchant/branch/device fields on purpose: those come from the device token, never the body.
export const DeviceEventsBatchBody = z.object({
  events: z.array(DeviceEvent).min(1).max(DEVICE_EVENTS_BATCH_MAX),
});
export type DeviceEventsBatchBody = z.infer<typeof DeviceEventsBatchBody>;

export interface DeviceEventsBatchResponse {
  /** Newly stored. */
  accepted: number;
  /** Already stored from an earlier upload of the same client id. */
  duplicates: number;
  /** Older than the 7-day window; not stored. */
  dropped: number;
  /**
   * Named a session that is not this device's, or a catalog item this merchant cannot
   * reference; not stored. Per event rather than failing the batch: a device retries a
   * failed batch, and one bad event must not block every later upload behind it.
   */
  rejected: number;
}

export const AnalyticsHeatmapMetric = z.enum(['sessions', 'tryons']);
export type AnalyticsHeatmapMetric = z.infer<typeof AnalyticsHeatmapMetric>;

export const AnalyticsHeatmapQuery = AnalyticsQuery.extend({
  metric: AnalyticsHeatmapMetric.default('sessions'),
});
export type AnalyticsHeatmapQuery = z.infer<typeof AnalyticsHeatmapQuery>;

export interface AnalyticsHeatmapCell {
  /** 0 = Sunday … 6 = Saturday, in the window's tz (Postgres `extract(dow)`). */
  weekday: number;
  /** 0–23, local hour in the window's tz. */
  hour: number;
  value: number;
}

export interface AnalyticsHeatmapResponse {
  window: { from: string; to: string; tz: string };
  metric: AnalyticsHeatmapMetric;
  /** Always 168 cells (7 × 24), zero-filled, ordered by weekday then hour. */
  cells: AnalyticsHeatmapCell[];
}
