import { schema } from '@aivastra/db';
import { AdminMerchantDeviceUpdateBody } from '@aivastra/types';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { updateDevice } from '../merchant/org-devices.routes.js';
import { requirePermission } from './guard.js';
import { ORG_EDIT } from './merchant-org.routes.js';

// Same role gate as branch/staff edits (see ORG_EDIT): SUPER_ADMIN and ADMIN.
export async function adminMerchantDeviceRoutes(app: FastifyInstance) {
  app.get(
    '/admin/merchants/:id/devices',
    {
      preHandler: requirePermission('merchants.read'),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const rows = await app.db
        .select({
          id: schema.merchantDevices.id,
          branchId: schema.merchantDevices.branchId,
          name: schema.merchantDevices.name,
          isActive: schema.merchantDevices.isActive,
          paired: schema.merchantDevices.deviceTokenHash,
          lastSeenAt: schema.merchantDevices.lastSeenAt,
        })
        .from(schema.merchantDevices)
        .where(eq(schema.merchantDevices.merchantId, id))
        .orderBy(asc(schema.merchantDevices.createdAt));
      return rows.map((r) => ({ ...r, paired: r.paired !== null }));
    },
  );

  app.patch(
    '/admin/merchants/:id/devices/:deviceId',
    {
      preHandler: ORG_EDIT,
      schema: {
        params: z.object({ id: z.string().uuid(), deviceId: z.string().uuid() }),
        body: AdminMerchantDeviceUpdateBody,
      },
    },
    async (req) => {
      const { id, deviceId } = req.params as { id: string; deviceId: string };
      return updateDevice(
        app,
        req,
        deviceId,
        req.body as z.infer<typeof AdminMerchantDeviceUpdateBody>,
        {
          merchantId: id,
          actor: { userId: req.userId, role: req.adminRole! },
        },
      );
    },
  );
}
