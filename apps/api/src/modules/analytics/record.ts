import { schema } from '@aivastra/db';
import type { AnalyticsEventProps, AnalyticsServerEvent } from '@aivastra/types';

// Server-side analytics emission (analytics phase 1, plan Task 3).
//
// Always called with the SAME transaction as the source write (session insert, sale,
// void, paid try-on charge), so an event exists exactly when its fact does: a rolled-back
// sale leaves no sale_recorded behind, and a committed one cannot lose its event.
// analytics_events has no foreign keys for exactly this reason: the insert can only fail
// when the database itself is failing, never because of the data.
//
// ADVISORY: nothing may read these rows for a credit, limit or authorization decision.

/** Anything with an insert(): a transaction (the only intended caller) or the db. */
// biome-ignore lint/suspicious/noExplicitAny: same tx widening as create-tryon-job.ts's chargeJob.
type Writer = { insert: (...args: any[]) => any };

export interface ServerEvent {
  event: AnalyticsServerEvent;
  merchantId: string;
  branchId?: string | null;
  deviceId?: string | null;
  staffId?: string | null;
  sessionId?: string | null;
  catalogItemId?: string | null;
  /** Session mode today (kiosk | assisted); other channels as they join. */
  channel?: string | null;
  props?: AnalyticsEventProps;
  /** Defaults to now. */
  occurredAt?: Date;
}

function row(e: ServerEvent) {
  return {
    event: e.event,
    merchantId: e.merchantId,
    branchId: e.branchId ?? null,
    deviceId: e.deviceId ?? null,
    staffId: e.staffId ?? null,
    sessionId: e.sessionId ?? null,
    catalogItemId: e.catalogItemId ?? null,
    channel: e.channel ?? null,
    props: e.props ?? {},
    occurredAt: e.occurredAt ?? new Date(),
  };
}

export async function recordEvents(tx: Writer, events: ServerEvent[]): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(schema.analyticsEvents).values(events.map(row));
}

export async function recordEvent(tx: Writer, event: ServerEvent): Promise<void> {
  await recordEvents(tx, [event]);
}

interface SessionDims {
  id: string;
  merchantId: string;
  branchId: string;
  deviceId: string;
  mode: string;
}
interface VoidedSale {
  id: string;
  catalogItemId: string;
  staffId: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
}

/**
 * Both void paths (the seller's 24-hour undo on the device, the merchant admin's any-time
 * void) write the same event. Staff is the SELLER (session_items.staff_id), not whoever
 * voided, so a staff member's net sales are sale_recorded minus sale_voided.
 */
export async function recordSaleVoided(
  tx: Writer,
  s: SessionDims,
  item: VoidedSale,
): Promise<void> {
  await recordEvent(tx, {
    event: 'sale_voided',
    merchantId: s.merchantId,
    branchId: s.branchId,
    deviceId: s.deviceId,
    staffId: item.staffId,
    sessionId: s.id,
    catalogItemId: item.catalogItemId,
    channel: s.mode,
    props: item.voidedBy
      ? { sessionItemId: item.id, voidedBy: item.voidedBy }
      : { sessionItemId: item.id },
    occurredAt: item.voidedAt ?? undefined,
  });
}
