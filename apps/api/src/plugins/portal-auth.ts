import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess } from '../modules/auth/service.js';

export const portalAuthPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  // Authorizes off the same access token the catalogues-web user session uses
  // (aud-less, kind:'access', sub = users.id) — a merchant is a user with a
  // merchants profile attached, so there is no separate merchant login/token.
  async function userIdFromBearer(req: FastifyRequest): Promise<string> {
    const h = req.headers.authorization;
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
  app.decorate('requireMerchantMember', async (req, _reply) => {
    const userId = await userIdFromBearer(req);

    const [owner] = await app.db
      .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, userId))
      .limit(1);
    if (owner) {
      if (!owner.isActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');
      req.merchantMember = {
        merchantId: owner.id,
        userId,
        role: 'admin',
        branchId: null,
        staffId: null,
      };
      return;
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
    req.merchantMember = {
      merchantId: staff.merchantId,
      userId,
      role: 'staff',
      branchId: staff.branchId,
      staffId: staff.staffId,
    };
  });

  app.decorate('requireMerchantAdmin', async (req, reply) => {
    await app.requireMerchantMember(req, reply);
    if (req.merchantMember?.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'merchant admin required');
    }
  });
});

export interface MerchantMember {
  merchantId: string;
  userId: string;
  role: 'admin' | 'staff';
  branchId: string | null;
  staffId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchantClientId?: string;
    merchantMember?: MerchantMember;
  }
  interface FastifyInstance {
    requireMerchant: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchantMember: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchantAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
