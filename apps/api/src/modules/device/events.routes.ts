import { createHash } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  type AnalyticsEventProps,
  DeviceEventsBatchBody,
  type DeviceEventsBatchResponse,
} from '@aivastra/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { merchantCanReferenceCatalogItem } from '../merchant/resolve-tryon-garment.js';

// Analytics phase 1, plan Task 4: the tablet's batch upload of what it saw (views, clicks).
// Only ANALYTICS_CLIENT_EVENTS pass the body schema, so a device can never report a
// session, a try-on or a sale; those are server events. Everything that places an event
// (merchant, branch, device) comes from the device token, never the body.

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 24 * 3_600_000;

// The global limiter keys on the visitor IP, and every tablet in a store shares the store's
// NAT address. This route keys on the device token instead (hashed, so the raw token never
// becomes a Redis key). The limiter runs at onRequest, before requireDevice, hence the header.
function deviceKey(req: { headers: Record<string, unknown>; ip: string }): string {
  const h = req.headers.authorization;
  return typeof h === 'string' && h.startsWith('Device ')
    ? `device-events:${createHash('sha256').update(h.slice(7).trim()).digest('hex')}`
    : req.ip;
}

export async function deviceEventsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/device/events',
    {
      preHandler: app.requireDevice,
      schema: { body: DeviceEventsBatchBody },
      config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: deviceKey } },
    },
    async (req): Promise<DeviceEventsBatchResponse> => {
      const d = req.device!;
      const { events } = req.body as z.infer<typeof DeviceEventsBatchBody>;
      const now = Date.now();

      // Sessions: only this device's. A session from another device (or none at all) is a
      // rejected event, not a 404 for the batch.
      const sessionIds = [...new Set(events.flatMap((e) => (e.sessionId ? [e.sessionId] : [])))];
      const sessions = new Map(
        (sessionIds.length
          ? await app.db
              .select({
                id: schema.instoreSessions.id,
                branchId: schema.instoreSessions.branchId,
                staffId: schema.instoreSessions.staffId,
                mode: schema.instoreSessions.mode,
              })
              .from(schema.instoreSessions)
              .where(
                and(
                  inArray(schema.instoreSessions.id, sessionIds),
                  eq(schema.instoreSessions.deviceId, d.deviceId),
                ),
              )
          : []
        ).map((s) => [s.id, s]),
      );

      // Catalog items: the merchant's own, INCLUDING soft-deleted ones (a view recorded
      // before a staff delete is still true history, and an offline upload can arrive after
      // it), else an assigned demo item. merchantCanReferenceCatalogItem refuses deleted
      // items, which is right for new try-ons and sales but wrong here, so own items are
      // checked directly and only the remainder falls through to it.
      const itemIds = [
        ...new Set(events.flatMap((e) => (e.catalogItemId ? [e.catalogItemId] : []))),
      ];
      const allowedItems = new Set(
        itemIds.length
          ? (
              await app.db
                .select({ id: schema.merchantCatalogItems.id })
                .from(schema.merchantCatalogItems)
                .where(
                  and(
                    inArray(schema.merchantCatalogItems.id, itemIds),
                    eq(schema.merchantCatalogItems.merchantId, d.merchantId),
                  ),
                )
            ).map((r) => r.id)
          : [],
      );
      for (const id of itemIds) {
        if (!allowedItems.has(id) && (await merchantCanReferenceCatalogItem(app, d.merchantId, id)))
          allowedItems.add(id);
      }

      let dropped = 0;
      let rejected = 0;
      const rows = [];
      for (const e of events) {
        const session = e.sessionId ? sessions.get(e.sessionId) : undefined;
        if ((e.sessionId && !session) || (e.catalogItemId && !allowedItems.has(e.catalogItemId))) {
          rejected++;
          continue;
        }
        let occurred = Date.parse(e.occurredAt);
        if (now - occurred > MAX_AGE_MS) {
          dropped++;
          continue;
        }
        const props: AnalyticsEventProps = { ...(e.props ?? {}) };
        if (occurred - now > MAX_FUTURE_SKEW_MS) {
          // A tablet clock far ahead would otherwise file the event in a future bucket.
          occurred = now;
          props.clockSkew = true;
        }
        rows.push({
          clientEventId: e.id,
          event: e.event,
          merchantId: d.merchantId,
          // In a session: the session's branch and staff (a device moved mid-session keeps
          // its session's branch, same rule as try-on jobs). Outside one: the device's branch.
          branchId: session?.branchId ?? d.branchId,
          deviceId: d.deviceId,
          staffId: session?.staffId ?? null,
          sessionId: session?.id ?? null,
          catalogItemId: e.catalogItemId ?? null,
          channel: session?.mode ?? null,
          props,
          occurredAt: new Date(occurred),
        });
      }

      const inserted = rows.length
        ? await app.db
            .insert(schema.analyticsEvents)
            .values(rows)
            .onConflictDoNothing({
              target: [schema.analyticsEvents.deviceId, schema.analyticsEvents.clientEventId],
            })
            .returning({ id: schema.analyticsEvents.id })
        : [];

      return {
        accepted: inserted.length,
        duplicates: rows.length - inserted.length,
        dropped,
        rejected,
      };
    },
  );
}
