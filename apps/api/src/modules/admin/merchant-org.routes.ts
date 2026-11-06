import { schema } from '@aivastra/db';
import { AdminMerchantBranchUpdateBody, AdminMerchantStaffUpdateBody } from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { updateStaff } from '../merchant/org.routes.js';
import { recordAudit } from './audit.js';
import { requireAdmin, requirePermission } from './guard.js';

// AiVastra admin can alter any merchant org setting (v1-hld.md §3.4). Creation
// stays with the merchant admin in Merchant Web; admin corrects and overrides.
// Same role gate as the agreed-price routes (unlimitedPlan.routes.ts): correcting a
// merchant's branches and staff is open to ADMIN, while staff limit / quota / store URL
// stay on merchants.write (SUPER_ADMIN) in merchants.routes.ts.
const ORG_EDIT = requireAdmin(['SUPER_ADMIN', 'ADMIN']);

export async function adminMerchantOrgRoutes(app: FastifyInstance) {
  app.get(
    '/admin/merchants/:id/org',
    { preHandler: requirePermission('merchants.read') },
    async (req) => {
      const { id } = req.params as { id: string };
      const [merchant] = await app.db
        .select({
          staffLimitPerBranch: schema.merchants.staffLimitPerBranch,
          deviceQuotaPerMonth: schema.merchants.deviceQuotaPerMonth,
          storeUrl: schema.merchants.storeUrl,
        })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, id));
      if (!merchant) throw new AppError('NOT_FOUND', 404, 'Merchant not found');

      const branches = await app.db
        .select()
        .from(schema.merchantBranches)
        .where(eq(schema.merchantBranches.merchantId, id))
        .orderBy(asc(schema.merchantBranches.createdAt));
      const staff = await app.db
        .select({
          id: schema.merchantStaff.id,
          branchId: schema.merchantStaff.branchId,
          userId: schema.merchantStaff.userId,
          email: schema.users.email,
          displayName: schema.users.displayName,
          isActive: schema.merchantStaff.isActive,
          createdAt: schema.merchantStaff.createdAt,
        })
        .from(schema.merchantStaff)
        .innerJoin(schema.users, eq(schema.users.id, schema.merchantStaff.userId))
        .where(eq(schema.merchantStaff.merchantId, id))
        .orderBy(asc(schema.merchantStaff.createdAt));

      return {
        ...merchant,
        branches: branches.map((b) => ({ ...b, staff: staff.filter((s) => s.branchId === b.id) })),
      };
    },
  );

  app.patch(
    '/admin/merchants/:id/branches/:branchId',
    { preHandler: ORG_EDIT, schema: { body: AdminMerchantBranchUpdateBody } },
    async (req) => {
      const { id, branchId } = req.params as { id: string; branchId: string };
      const body = req.body as z.infer<typeof AdminMerchantBranchUpdateBody>;
      return app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.merchantBranches)
          .where(
            and(
              eq(schema.merchantBranches.id, branchId),
              eq(schema.merchantBranches.merchantId, id),
            ),
          )
          .for('update');
        if (!existing) throw new AppError('NOT_FOUND', 404, 'branch not found');
        const [row] = await tx
          .update(schema.merchantBranches)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.merchantBranches.id, branchId))
          .returning();
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'merchant_branch.update',
          resourceType: 'merchant_branch',
          resourceId: branchId,
          before: existing,
          after: row,
          request: req,
        });
        return row!;
      });
    },
  );

  app.patch(
    '/admin/merchants/:id/staff/:staffId',
    { preHandler: ORG_EDIT, schema: { body: AdminMerchantStaffUpdateBody } },
    async (req) => {
      const { id, staffId } = req.params as { id: string; staffId: string };
      return updateStaff(
        app,
        req,
        staffId,
        req.body as z.infer<typeof AdminMerchantStaffUpdateBody>,
        {
          merchantId: id,
          actor: { userId: req.userId, role: req.adminRole! },
        },
      );
    },
  );
}
