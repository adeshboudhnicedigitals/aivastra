import { schema } from '@aivastra/db';
import { MerchantBrandUpdateBody } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';

// Same actor role merchant-admin writes use in org.routes.ts, so Team Activity can tell
// them apart from AiVastra admin roles.
const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';

type BrandRow = {
  companyName: string;
  storeUrl: string | null;
  logoKey: string | null;
  logoOverlayEnabled: boolean;
  staffLimitPerBranch: number;
  deviceQuotaPerMonth: number | null;
};

// logoUrl is presigned exactly as /v1/auth/device-login does (1h); the raw key never leaves.
async function brandPayload(app: FastifyInstance, row: BrandRow) {
  return {
    companyName: row.companyName,
    storeUrl: row.storeUrl,
    logoUrl: row.logoKey ? (await app.storage.presignGet(row.logoKey, 3600)).url : null,
    logoOverlayEnabled: row.logoOverlayEnabled,
    staffLimitPerBranch: row.staffLimitPerBranch,
    deviceQuotaPerMonth: row.deviceQuotaPerMonth,
  };
}

const brandColumns = {
  companyName: schema.merchants.companyName,
  storeUrl: schema.merchants.storeUrl,
  logoKey: schema.merchants.logoKey,
  logoOverlayEnabled: schema.merchants.logoOverlayEnabled,
  staffLimitPerBranch: schema.merchants.staffLimitPerBranch,
  deviceQuotaPerMonth: schema.merchants.deviceQuotaPerMonth,
};

// Merchant Web brand settings (3c). Every member reads; only a merchant admin may change
// storeUrl. Logo, overlay, staff limit and device quota are AiVastra-admin-only.
export async function merchantBrandRoutes(app: FastifyInstance) {
  app.get('/v1/merchant/brand', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    const [row] = await app.db
      .select(brandColumns)
      .from(schema.merchants)
      .where(eq(schema.merchants.id, m.merchantId));
    if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');
    return brandPayload(app, row);
  });

  app.patch(
    '/v1/merchant/brand',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantBrandUpdateBody } },
    async (req) => {
      const m = req.merchantMember!;
      const { storeUrl } = req.body as MerchantBrandUpdateBody;

      const row = await app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select(brandColumns)
          .from(schema.merchants)
          .where(eq(schema.merchants.id, m.merchantId))
          .for('update');
        if (!existing) throw new AppError('NOT_FOUND', 404, 'merchant not found');

        const [updated] = await tx
          .update(schema.merchants)
          .set({ storeUrl, updatedAt: new Date() })
          .where(eq(schema.merchants.id, m.merchantId))
          .returning(brandColumns);
        if (!updated) throw new AppError('NOT_FOUND', 404, 'merchant not found');

        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant.brand_update',
          resourceType: 'merchant',
          resourceId: m.merchantId,
          before: { storeUrl: existing.storeUrl },
          after: { storeUrl: updated.storeUrl },
          request: req,
        });
        return updated;
      });

      return brandPayload(app, row);
    },
  );
}
