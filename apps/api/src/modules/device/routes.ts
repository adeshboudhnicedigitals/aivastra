import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  DevicePairBody,
  DeviceSessionCreateBody,
  DeviceSessionItemBody,
  DeviceTryonJobBody,
  MerchantTryonPresignBody,
} from '@aivastra/types';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { recordAudit } from '../admin/audit.js';
import { recordEvent, recordSaleVoided } from '../analytics/record.js';
import { merchantCanReferenceCatalogItem } from '../merchant/resolve-tryon-garment.js';
import { createGarmentTryonJob } from '../merchant/tryon-job-service.js';
import { deviceAuditActor } from './audit.js';
import { generateDeviceToken, sha256 } from './secrets.js';

export async function deviceRoutes(app: FastifyInstance) {
  // Unauthenticated by design: the one-time code IS the credential. Wrong, expired and
  // already-used codes are indistinguishable (same 400) so codes cannot be probed, and the
  // per-IP limit bounds guessing of an 8-char code that lives 15 minutes.
  app.post(
    '/v1/device/pair',
    {
      schema: { body: DevicePairBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { code } = req.body as z.infer<typeof DevicePairBody>;
      const token = generateDeviceToken();
      return app.db.transaction(async (tx) => {
        // Atomic claim: only one concurrent caller can match all four predicates.
        const [device] = await tx
          .update(schema.merchantDevices)
          .set({
            deviceTokenHash: sha256(token),
            pairingCodeHash: null,
            pairingExpiresAt: null,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.merchantDevices.pairingCodeHash, sha256(code)),
              gt(schema.merchantDevices.pairingExpiresAt, sql`now()`),
              isNull(schema.merchantDevices.deviceTokenHash),
              eq(schema.merchantDevices.isActive, true),
            ),
          )
          .returning({
            id: schema.merchantDevices.id,
            merchantId: schema.merchantDevices.merchantId,
            branchId: schema.merchantDevices.branchId,
            name: schema.merchantDevices.name,
          });
        if (!device)
          throw new AppError('INVALID_PAIRING_CODE', 400, 'invalid or expired pairing code');

        await recordAudit(tx, {
          actor: await deviceAuditActor(tx, device.merchantId),
          action: 'merchant_device.pair',
          resourceType: 'merchant_device',
          resourceId: device.id,
          after: { branchId: device.branchId, name: device.name },
          request: req,
        });
        return {
          token,
          deviceId: device.id,
          merchantId: device.merchantId,
          branchId: device.branchId,
          name: device.name,
        };
      });
    },
  );

  app.get('/v1/device/me', { preHandler: app.requireDevice }, async (req) => {
    const d = req.device;
    if (!d) throw new AppError('DEVICE_INACTIVE', 401, 'device not recognised or inactive');
    return d;
  });

  const DEVICE_SESSION_PREHANDLER = { preHandler: app.requireDevice };

  async function loadOwnSession(deviceId: string, sessionId: string) {
    const [s] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(
        and(
          eq(schema.instoreSessions.id, sessionId),
          eq(schema.instoreSessions.deviceId, deviceId),
        ),
      );
    if (!s) throw new AppError('NOT_FOUND', 404, 'session not found');
    return s;
  }

  app.post(
    '/v1/device/sessions',
    { ...DEVICE_SESSION_PREHANDLER, schema: { body: DeviceSessionCreateBody } },
    async (req, reply) => {
      const d = req.device!;
      const { mode } = req.body as z.infer<typeof DeviceSessionCreateBody>;
      let staffId: string | null = null;
      if (mode === 'assisted') {
        const member = await app.resolveStaffFromRequest(req);
        if (
          member.role !== 'staff' ||
          member.merchantId !== d.merchantId ||
          member.branchId !== d.branchId
        ) {
          throw new AppError('FORBIDDEN', 403, "staff of this device's branch required");
        }
        staffId = member.staffId;
      }
      const session = await withIdempotency(
        app,
        'device-sessions',
        d.deviceId,
        req.headers['idempotency-key'] as string | undefined,
        () =>
          app.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(schema.instoreSessions)
              .values({
                merchantId: d.merchantId,
                branchId: d.branchId,
                deviceId: d.deviceId,
                staffId,
                mode,
              })
              .returning();
            await recordAudit(tx, {
              actor: await deviceAuditActor(tx, d.merchantId),
              action: 'instore_session.start',
              resourceType: 'instore_session',
              resourceId: row!.id,
              after: { mode, staffId, deviceId: d.deviceId },
              request: req,
            });
            // Inside withIdempotency: a replayed start returns the stored session and runs
            // none of this, so it writes no second event.
            await recordEvent(tx, {
              event: 'session_started',
              merchantId: d.merchantId,
              branchId: row!.branchId,
              deviceId: d.deviceId,
              staffId,
              sessionId: row!.id,
              channel: mode,
              occurredAt: row!.startedAt,
            });
            return row!;
          }),
      );
      return reply.code(201).send(session);
    },
  );

  app.post(
    '/v1/device/sessions/:id/end',
    { ...DEVICE_SESSION_PREHANDLER, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const s = await loadOwnSession(d.deviceId, id);
      if (s.endedAt) return s; // ending twice is a no-op, not an error: the kiosk may retry
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.instoreSessions)
          .set({ endedAt: new Date() })
          .where(and(eq(schema.instoreSessions.id, id), isNull(schema.instoreSessions.endedAt)))
          .returning();
        if (row) {
          await recordAudit(tx, {
            actor: await deviceAuditActor(tx, d.merchantId),
            action: 'instore_session.end',
            resourceType: 'instore_session',
            resourceId: id,
            request: req,
          });
          // Only when this call actually ended it: losing a race with the idle sweeper (which
          // writes its own 'idle' event) leaves row undefined.
          await recordEvent(tx, {
            event: 'session_ended',
            merchantId: row.merchantId,
            branchId: row.branchId,
            deviceId: row.deviceId,
            staffId: row.staffId,
            sessionId: row.id,
            channel: row.mode,
            props: { reason: 'done' },
            occurredAt: row.endedAt ?? undefined,
          });
        }
        return row ?? s;
      });
    },
  );

  app.post(
    '/v1/device/sessions/:id/items',
    {
      ...DEVICE_SESSION_PREHANDLER,
      schema: { params: z.object({ id: z.string().uuid() }), body: DeviceSessionItemBody },
    },
    async (req, reply) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof DeviceSessionItemBody>;
      const s = await loadOwnSession(d.deviceId, id);
      if (s.endedAt) throw new AppError('SESSION_ENDED', 409, 'session already ended');
      // "Sold" is the staff button: only a session started by a logged-in staff member.
      if (body.action === 'sold' && s.mode !== 'assisted') {
        throw new AppError(
          'SOLD_REQUIRES_ASSISTED',
          409,
          'sales can only be recorded in an assisted session',
        );
      }
      // session_items.catalog_item_id has no FK (demo items are not merchant rows), so
      // ownership is enforced here: another merchant's id must not land in this report.
      if (!(await merchantCanReferenceCatalogItem(app, d.merchantId, body.catalogItemId))) {
        throw new AppError('NOT_FOUND', 404, 'catalog item not found');
      }
      const item = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.sessionItems)
          .values({
            sessionId: id,
            catalogItemId: body.catalogItemId,
            action: body.action,
            staffId: body.action === 'sold' ? s.staffId : null,
          })
          .returning();
        await tx
          .update(schema.instoreSessions)
          .set({ lastActivityAt: new Date() })
          .where(eq(schema.instoreSessions.id, id));
        if (body.action === 'sold') {
          await recordAudit(tx, {
            actor: await deviceAuditActor(tx, d.merchantId),
            action: 'session_item.sold',
            resourceType: 'session_item',
            resourceId: row!.id,
            after: { sessionId: id, catalogItemId: body.catalogItemId, staffId: s.staffId },
            request: req,
          });
        }
        // Staff matches queries.ts ITEM_STAFF: a sale is the seller's (s.staffId, the only
        // staff who can sell here); the device writes wishlists with no item staff, so a
        // wishlist falls back to the session's assisting staff, which is the same s.staffId.
        await recordEvent(tx, {
          event: body.action === 'sold' ? 'sale_recorded' : 'item_wishlisted',
          merchantId: s.merchantId,
          branchId: s.branchId,
          deviceId: s.deviceId,
          staffId: s.staffId,
          sessionId: s.id,
          catalogItemId: body.catalogItemId,
          channel: s.mode,
          props: { sessionItemId: row!.id },
          occurredAt: row!.createdAt,
        });
        return row!;
      });
      return reply.code(201).send(item);
    },
  );

  // Undo a sale on the device: only the staff member who made it, within 24 hours. The
  // merchant admin voids at any time via /v1/merchant/org/session-items/:id/void.
  app.delete(
    '/v1/device/sessions/:id/items/:itemId',
    {
      ...DEVICE_SESSION_PREHANDLER,
      schema: { params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }) },
    },
    async (req) => {
      const d = req.device!;
      const { id, itemId } = req.params as { id: string; itemId: string };
      const s = await loadOwnSession(d.deviceId, id);
      const member = await app.resolveStaffFromRequest(req);
      return app.db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.sessionItems)
          .where(
            and(
              eq(schema.sessionItems.id, itemId),
              eq(schema.sessionItems.sessionId, id),
              eq(schema.sessionItems.action, 'sold'),
            ),
          )
          .for('update');
        if (!item) throw new AppError('NOT_FOUND', 404, 'sale not found');
        if (item.voidedAt) throw new AppError('ALREADY_VOIDED', 409, 'sale already voided');
        if (member.role !== 'staff' || member.staffId !== item.staffId) {
          throw new AppError('FORBIDDEN', 403, 'only the selling staff member can undo this sale');
        }
        if (Date.now() - item.createdAt.getTime() > 24 * 3_600_000) {
          throw new AppError(
            'UNDO_WINDOW_PASSED',
            403,
            'the 24-hour undo window has passed; ask the merchant admin',
          );
        }
        const [row] = await tx
          .update(schema.sessionItems)
          .set({ voidedAt: new Date(), voidedBy: member.userId })
          .where(eq(schema.sessionItems.id, itemId))
          .returning();
        await recordAudit(tx, {
          actor: await deviceAuditActor(tx, d.merchantId),
          action: 'session_item.void',
          resourceType: 'session_item',
          resourceId: itemId,
          after: { voidedBy: member.userId },
          request: req,
        });
        await recordSaleVoided(tx, s, row!);
        return row!;
      });
    },
  );

  // Customer photo upload for the kiosk: same key layout/ownership record as the merchant
  // presign, so assertOwnedCustomerPhoto accepts it unchanged.
  app.post(
    '/v1/device/tryon/presign',
    { preHandler: app.requireDevice, schema: { body: MerchantTryonPresignBody } },
    async (req) => {
      const d = req.device!;
      const { contentType, contentLength } = req.body as z.infer<typeof MerchantTryonPresignBody>;
      const ext = contentType.split('/')[1] ?? 'jpg';
      const key = keys.merchantTryonInput(d.merchantId, randomUUID(), ext);
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, d.merchantId, 'EX', 600);
      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.post(
    '/v1/device/tryon/jobs',
    { preHandler: app.requireDevice, schema: { body: DeviceTryonJobBody } },
    async (req, reply) => {
      const d = req.device!;
      const { sessionId, merchantCatalogItemId, customerPhotoKey } = req.body as z.infer<
        typeof DeviceTryonJobBody
      >;
      const result = await withIdempotency(
        app,
        'device-tryon-jobs',
        d.deviceId,
        req.headers['idempotency-key'] as string | undefined,
        async () => {
          const session = await loadOwnSession(d.deviceId, sessionId);
          if (session.endedAt) throw new AppError('SESSION_ENDED', 409, 'session already ended');
          return createGarmentTryonJob(
            app,
            d.merchantId,
            { merchantCatalogItemId, customerPhotoKey },
            {
              // The session's branch, not the device's current one: a device moved mid-session
              // must not split jobs.branch_id from instore_sessions.branch_id.
              branchId: session.branchId,
              deviceId: d.deviceId,
              sessionId: session.id,
              staffId: session.staffId,
              catalogItemId: merchantCatalogItemId,
              channel: session.mode,
            },
          );
        },
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/v1/device/tryon/jobs/:id',
    { preHandler: app.requireDevice, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          resultKey: schema.jobOutputs.resultKey,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.deviceId, d.deviceId)))
        .limit(1);
      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      const resultUrl =
        job.status === 'COMPLETED' && job.resultKey
          ? await app.storage
              .presignGet(job.resultKey, 3600)
              .then((r) => r.url)
              .catch(() => null)
          : null;
      // shareUrl duplicates resultUrl for the Android app, whose status model reads that name
      // from the owner route (device-mode plan, M6).
      return {
        id: job.id,
        status: job.status,
        errorCode: job.errorCode,
        resultUrl,
        shareUrl: resultUrl,
      };
    },
  );
}
