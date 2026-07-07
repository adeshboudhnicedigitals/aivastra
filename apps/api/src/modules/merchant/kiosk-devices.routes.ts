import { schema } from '@aivastra/db';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createKioskDevice, generatePairingCode, hashPairingCode } from '../kiosk/provisioning.js';

const CreateDeviceBody = z.object({ label: z.string().min(1).max(120) });
const PatchDeviceBody = z
  .object({
    label: z.string().min(1).max(120).optional(),
    status: z.literal('revoked').optional(),
  })
  .refine((body) => body.label !== undefined || body.status !== undefined, {
    message: 'label or status is required',
  });

function publicDevice(device: typeof schema.kioskDevices.$inferSelect) {
  const { pairingCodeHash: _pairingCodeHash, ...rest } = device;
  return rest;
}

export async function merchantKioskDevicesRoutes(app: FastifyInstance) {
  app.post(
    '/v1/merchant/kiosk-devices',
    { preHandler: app.requireMerchant, schema: { body: CreateDeviceBody } },
    async (req, reply) => {
      const clientId = req.merchantClientId;
      if (!clientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { label } = req.body as z.infer<typeof CreateDeviceBody>;

      const [[client], [deviceCount]] = await Promise.all([
        app.db
          .select({
            kioskEnabled: schema.widgetClients.kioskEnabled,
            maxKioskDevices: schema.widgetClients.maxKioskDevices,
          })
          .from(schema.widgetClients)
          .where(eq(schema.widgetClients.id, clientId))
          .limit(1),
        app.db
          .select({ n: count() })
          .from(schema.kioskDevices)
          .where(
            and(
              eq(schema.kioskDevices.widgetClientId, clientId),
              ne(schema.kioskDevices.status, 'revoked'),
            ),
          ),
      ]);
      if (!client) throw new AppError('NOT_FOUND', 404, 'merchant not found');
      if (!client.kioskEnabled) {
        throw new AppError('FORBIDDEN', 403, 'kiosk access is not enabled for this merchant');
      }
      if ((deviceCount?.n ?? 0) >= client.maxKioskDevices) {
        throw new AppError('CONFLICT', 409, 'maximum kiosk devices reached');
      }

      const { device, pairingCode } = await createKioskDevice(app, clientId, label);
      reply.code(201);
      return { device: publicDevice(device), pairingCode };
    },
  );

  app.get('/v1/merchant/kiosk-devices', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = req.merchantClientId;
    if (!clientId) throw new AppError('UNAUTH', 401, 'missing merchant');
    const devices = await app.db
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.widgetClientId, clientId))
      .orderBy(desc(schema.kioskDevices.createdAt));
    return { devices: devices.map(publicDevice) };
  });

  app.patch(
    '/v1/merchant/kiosk-devices/:id',
    { preHandler: app.requireMerchant, schema: { body: PatchDeviceBody } },
    async (req) => {
      const clientId = req.merchantClientId;
      if (!clientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchDeviceBody>;
      const now = new Date();
      const [updated] = await app.db
        .update(schema.kioskDevices)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.status === 'revoked' ? { status: 'revoked', revokedAt: now } : {}),
          updatedAt: now,
        })
        .where(
          and(eq(schema.kioskDevices.id, id), eq(schema.kioskDevices.widgetClientId, clientId)),
        )
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'kiosk device not found');
      return publicDevice(updated);
    },
  );

  app.post(
    '/v1/merchant/kiosk-devices/:id/pairing-code',
    { preHandler: app.requireMerchant },
    async (req) => {
      const clientId = req.merchantClientId;
      if (!clientId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { id } = req.params as { id: string };
      const pairingCode = generatePairingCode();
      const now = new Date();
      const [updated] = await app.db
        .update(schema.kioskDevices)
        .set({
          status: 'pending',
          pairingCodeHash: hashPairingCode(pairingCode),
          pairingCodeExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
          revokedAt: null,
          pairedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.kioskDevices.id, id),
            eq(schema.kioskDevices.widgetClientId, clientId),
            ne(schema.kioskDevices.status, 'active'),
          ),
        )
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'kiosk device not found or active');
      return { device: publicDevice(updated), pairingCode };
    },
  );
}
