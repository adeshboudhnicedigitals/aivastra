import { schema } from '@aivastra/db';
import { MerchantDeviceCreateBody, MerchantDeviceUpdateBody } from '@aivastra/types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { recordSaleVoided } from '../analytics/record.js';
import { generatePairingCode, sha256 } from '../device/secrets.js';

const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';
const PAIRING_TTL_MS = 15 * 60_000;

// Never select the token or code hashes into a response.
const deviceSelect = {
  id: schema.merchantDevices.id,
  branchId: schema.merchantDevices.branchId,
  name: schema.merchantDevices.name,
  isActive: schema.merchantDevices.isActive,
  paired: schema.merchantDevices.deviceTokenHash,
  lastSeenAt: schema.merchantDevices.lastSeenAt,
  createdAt: schema.merchantDevices.createdAt,
};

type LoadedDevice = NonNullable<Awaited<ReturnType<typeof loadDevice>>>;
type DeviceRow = Omit<LoadedDevice, 'paired'> & { paired: boolean };

async function loadDevice(
  db: Pick<FastifyInstance['db'], 'select'>,
  merchantId: string,
  deviceId: string,
) {
  const [row] = await db
    .select(deviceSelect)
    .from(schema.merchantDevices)
    .where(
      and(
        eq(schema.merchantDevices.id, deviceId),
        eq(schema.merchantDevices.merchantId, merchantId),
      ),
    );
  return row;
}

const present = (row: LoadedDevice): DeviceRow => ({
  ...row,
  paired: row.paired !== null,
});

/**
 * Shared by the merchant-admin route and the AiVastra admin route. Always scoped by
 * merchantId; a move verifies the target branch belongs to the same merchant (404
 * otherwise, never revealing another merchant's branch).
 */
export async function updateDevice(
  app: FastifyInstance,
  req: FastifyRequest,
  deviceId: string,
  body: z.infer<typeof MerchantDeviceUpdateBody>,
  ctx: { merchantId: string; actor: { userId: string; role: string } },
): Promise<DeviceRow> {
  return app.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.merchantDevices)
      .where(
        and(
          eq(schema.merchantDevices.id, deviceId),
          eq(schema.merchantDevices.merchantId, ctx.merchantId),
        ),
      )
      .for('update');
    if (!existing) throw new AppError('NOT_FOUND', 404, 'device not found');

    if (body.branchId && body.branchId !== existing.branchId) {
      const [branch] = await tx
        .select({ id: schema.merchantBranches.id, isActive: schema.merchantBranches.isActive })
        .from(schema.merchantBranches)
        .where(
          and(
            eq(schema.merchantBranches.id, body.branchId),
            eq(schema.merchantBranches.merchantId, ctx.merchantId),
          ),
        );
      if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');
      // Same rule as create: a device cannot be parked on a deactivated branch.
      if (!branch.isActive) throw new AppError('VALIDATION', 400, 'branch is inactive');
    }

    // A session belongs to one branch and one live device. Moving or deactivating the
    // device ends what is open, so jobs and sales never straddle two branches.
    const moved = Boolean(body.branchId && body.branchId !== existing.branchId);
    if (moved || body.isActive === false) {
      await tx
        .update(schema.instoreSessions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(schema.instoreSessions.deviceId, deviceId),
            isNull(schema.instoreSessions.endedAt),
          ),
        );
    }

    await tx
      .update(schema.merchantDevices)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.merchantDevices.id, deviceId));
    const after = await loadDevice(tx, ctx.merchantId, deviceId);
    await recordAudit(tx, {
      actor: ctx.actor,
      action: 'merchant_device.update',
      resourceType: 'merchant_device',
      resourceId: deviceId,
      before: { name: existing.name, branchId: existing.branchId, isActive: existing.isActive },
      after: { name: after?.name, branchId: after?.branchId, isActive: after?.isActive },
      request: req,
    });
    return present(after!);
  });
}

export async function merchantOrgDeviceRoutes(app: FastifyInstance) {
  app.post(
    '/v1/merchant/org/devices',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantDeviceCreateBody } },
    async (req, reply) => {
      const m = req.merchantMember!;
      const body = req.body as z.infer<typeof MerchantDeviceCreateBody>;
      const code = generatePairingCode();
      const expires = new Date(Date.now() + PAIRING_TTL_MS);
      const device = await app.db.transaction(async (tx) => {
        const [branch] = await tx
          .select({ id: schema.merchantBranches.id, isActive: schema.merchantBranches.isActive })
          .from(schema.merchantBranches)
          .where(
            and(
              eq(schema.merchantBranches.id, body.branchId),
              eq(schema.merchantBranches.merchantId, m.merchantId),
            ),
          );
        if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');
        if (!branch.isActive) throw new AppError('VALIDATION', 400, 'branch is inactive');
        const [row] = await tx
          .insert(schema.merchantDevices)
          .values({
            merchantId: m.merchantId,
            branchId: body.branchId,
            name: body.name,
            pairingCodeHash: sha256(code),
            pairingExpiresAt: expires,
          })
          .returning({
            id: schema.merchantDevices.id,
            branchId: schema.merchantDevices.branchId,
            name: schema.merchantDevices.name,
          });
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_device.create',
          resourceType: 'merchant_device',
          resourceId: row!.id,
          after: row,
          request: req,
        });
        return row!;
      });
      return reply
        .code(201)
        .send({ ...device, pairingCode: code, pairingExpiresAt: expires.toISOString() });
    },
  );

  app.get('/v1/merchant/org/devices', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    const scope =
      m.role === 'staff'
        ? and(
            eq(schema.merchantDevices.merchantId, m.merchantId),
            eq(schema.merchantDevices.branchId, m.branchId!),
          )
        : eq(schema.merchantDevices.merchantId, m.merchantId);
    const rows = await app.db
      .select(deviceSelect)
      .from(schema.merchantDevices)
      .where(scope)
      .orderBy(asc(schema.merchantDevices.createdAt));
    return rows.map(present);
  });

  app.patch(
    '/v1/merchant/org/devices/:id',
    {
      preHandler: app.requireMerchantAdmin,
      schema: { params: z.object({ id: z.string().uuid() }), body: MerchantDeviceUpdateBody },
    },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      return updateDevice(app, req, id, req.body as z.infer<typeof MerchantDeviceUpdateBody>, {
        merchantId: m.merchantId,
        actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
      });
    },
  );

  app.post(
    '/v1/merchant/org/session-items/:id/void',
    {
      preHandler: app.requireMerchantAdmin,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      return app.db.transaction(async (tx) => {
        const [found] = await tx
          .select({ item: schema.sessionItems, session: schema.instoreSessions })
          .from(schema.sessionItems)
          .innerJoin(
            schema.instoreSessions,
            eq(schema.instoreSessions.id, schema.sessionItems.sessionId),
          )
          .where(
            and(
              eq(schema.sessionItems.id, id),
              eq(schema.instoreSessions.merchantId, m.merchantId),
              eq(schema.sessionItems.action, 'sold'),
            ),
          )
          .for('update', { of: schema.sessionItems });
        if (!found) throw new AppError('NOT_FOUND', 404, 'sale not found');
        if (found.item.voidedAt) throw new AppError('ALREADY_VOIDED', 409, 'sale already voided');
        const [row] = await tx
          .update(schema.sessionItems)
          .set({ voidedAt: new Date(), voidedBy: m.userId })
          .where(eq(schema.sessionItems.id, id))
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'session_item.void',
          resourceType: 'session_item',
          resourceId: id,
          request: req,
        });
        await recordSaleVoided(tx, found.session, row!);
        return row!;
      });
    },
  );
}
