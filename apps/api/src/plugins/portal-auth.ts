import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess } from '../modules/auth/service.js';
import { sha256 } from '../modules/device/secrets.js';

export const portalAuthPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  // Authorizes off the same access token the catalogues-web user session uses
  // (aud-less, kind:'access', sub = users.id) — a merchant is a user with a
  // merchants profile attached, so there is no separate merchant login/token.
  async function userIdFromBearer(
    req: FastifyRequest,
    header: 'authorization' | 'x-staff-authorization' = 'authorization',
  ): Promise<string> {
    const h = req.headers[header] as string | undefined;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');
    try {
      const payload = await verifyAccess(secret, token);
      if ((payload as Record<string, unknown>).kind !== 'access') {
        throw new AppError('UNAUTH', 401, 'invalid token');
      }
      return String(payload.sub);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('UNAUTH', 401, 'invalid token');
    }
  }

  app.decorate('requireMerchant', async (req, _reply) => {
    const userId = await userIdFromBearer(req);
    const [client] = await app.db
      .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, userId))
      .limit(1);
    if (!client) throw new AppError('FORBIDDEN', 403, 'not a merchant account');
    if (!client.isActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');

    req.merchantClientId = client.id;
  });

  // v1.0 org model: the merchant OWNER is the merchant admin (no merchant_staff
  // row); anyone else must hold an active merchant_staff row in an active branch.
  // Owner-only routes keep using requireMerchant above, unchanged.
  async function memberFromUserId(userId: string): Promise<MerchantMember> {
    const [owner] = await app.db
      .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, userId))
      .limit(1);
    if (owner) {
      if (!owner.isActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');
      return {
        merchantId: owner.id,
        userId,
        role: 'admin',
        branchId: null,
        staffId: null,
      };
    }

    const [staff] = await app.db
      .select({
        staffId: schema.merchantStaff.id,
        merchantId: schema.merchantStaff.merchantId,
        branchId: schema.merchantStaff.branchId,
        staffActive: schema.merchantStaff.isActive,
        branchActive: schema.merchantBranches.isActive,
        merchantActive: schema.merchants.isActive,
      })
      .from(schema.merchantStaff)
      .innerJoin(
        schema.merchantBranches,
        eq(schema.merchantBranches.id, schema.merchantStaff.branchId),
      )
      .innerJoin(schema.merchants, eq(schema.merchants.id, schema.merchantStaff.merchantId))
      .where(eq(schema.merchantStaff.userId, userId))
      .limit(1);
    if (!staff) throw new AppError('FORBIDDEN', 403, 'not a merchant member');
    if (!staff.merchantActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');
    if (!staff.staffActive) throw new AppError('FORBIDDEN', 403, 'staff account inactive');
    if (!staff.branchActive) throw new AppError('FORBIDDEN', 403, 'branch inactive');
    return {
      merchantId: staff.merchantId,
      userId,
      role: 'staff',
      branchId: staff.branchId,
      staffId: staff.staffId,
    };
  }

  app.decorate('requireMerchantMember', async (req, _reply) => {
    req.merchantMember = await memberFromUserId(await userIdFromBearer(req));
  });

  // Catalogue routes serve the owner and any active staff member alike, and every query
  // is scoped by req.merchantClientId. Reuse the member check (owner -> admin, staff ->
  // active staff + branch + merchant, else 403) and project it onto that same field so
  // handlers written against requireMerchant need no change. A Device token has no bearer
  // and is rejected 401 by the member check.
  app.decorate('requireMerchantTeam', async (req, reply) => {
    await app.requireMerchantMember(req, reply);
    req.merchantClientId = req.merchantMember?.merchantId;
  });

  // Staff identify themselves on a shared device with their own access JWT in a second
  // header; the device token stays in Authorization.
  app.decorate('resolveStaffFromRequest', async (req) =>
    memberFromUserId(await userIdFromBearer(req, 'x-staff-authorization')),
  );

  app.decorate('requireMerchantAdmin', async (req, reply) => {
    await app.requireMerchantMember(req, reply);
    if (req.merchantMember?.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'merchant admin required');
    }
  });

  // v1.0 devices: `Authorization: Device <token>`. The token is sha256-hashed and looked up;
  // device, branch and merchant must all be active, so deactivating any of them rejects the
  // device's very next request. Legacy requireMerchant / email login are unaffected.
  app.decorate('requireDevice', async (req, _reply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Device ') ? h.slice(7).trim() : '';
    const inactive = () =>
      new AppError('DEVICE_INACTIVE', 401, 'device not recognised or inactive');
    if (!token) throw inactive();

    const [row] = await app.db
      .select({
        deviceId: schema.merchantDevices.id,
        merchantId: schema.merchantDevices.merchantId,
        branchId: schema.merchantDevices.branchId,
        name: schema.merchantDevices.name,
      })
      .from(schema.merchantDevices)
      .innerJoin(
        schema.merchantBranches,
        eq(schema.merchantBranches.id, schema.merchantDevices.branchId),
      )
      .innerJoin(schema.merchants, eq(schema.merchants.id, schema.merchantDevices.merchantId))
      .where(
        and(
          eq(schema.merchantDevices.deviceTokenHash, sha256(token)),
          eq(schema.merchantDevices.isActive, true),
          eq(schema.merchantBranches.isActive, true),
          eq(schema.merchants.isActive, true),
        ),
      )
      .limit(1);
    if (!row) throw inactive();

    await app.db
      .update(schema.merchantDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.merchantDevices.id, row.deviceId));
    req.device = row;
  });
});

export interface MerchantMember {
  merchantId: string;
  userId: string;
  role: 'admin' | 'staff';
  branchId: string | null;
  staffId: string | null;
}

export interface AuthenticatedDevice {
  deviceId: string;
  merchantId: string;
  branchId: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchantClientId?: string;
    merchantMember?: MerchantMember;
    device?: AuthenticatedDevice;
  }
  interface FastifyInstance {
    requireMerchant: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchantMember: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchantTeam: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchantAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireDevice: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    resolveStaffFromRequest: (req: FastifyRequest) => Promise<MerchantMember>;
  }
}
