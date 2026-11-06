import { type DbTransaction, schema } from '@aivastra/db';
import {
  MerchantBranchCreateBody,
  MerchantBranchUpdateBody,
  MerchantStaffCreateBody,
  MerchantStaffUpdateBody,
} from '@aivastra/types';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { hashPassword } from '../auth/service.js';

// Audit actor role for writes made by a merchant admin from Merchant Web —
// distinct from AiVastra admin roles so Team Activity can tell them apart.
const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';

const staffSelect = {
  id: schema.merchantStaff.id,
  branchId: schema.merchantStaff.branchId,
  userId: schema.merchantStaff.userId,
  email: schema.users.email,
  displayName: schema.users.displayName,
  isActive: schema.merchantStaff.isActive,
  createdAt: schema.merchantStaff.createdAt,
};

/**
 * Locks the branch row and refuses when it already holds staffLimitPerBranch
 * ACTIVE staff. Must run inside the transaction that then inserts/activates the
 * staff row: the FOR UPDATE lock is what serializes two concurrent creates so
 * both cannot pass the count.
 */
export async function assertBranchHasStaffCapacity(
  tx: DbTransaction,
  merchantId: string,
  branchId: string,
): Promise<void> {
  const [branch] = await tx
    .select({ id: schema.merchantBranches.id, isActive: schema.merchantBranches.isActive })
    .from(schema.merchantBranches)
    .where(
      and(
        eq(schema.merchantBranches.id, branchId),
        eq(schema.merchantBranches.merchantId, merchantId),
      ),
    )
    .for('update');
  if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');
  if (!branch.isActive) throw new AppError('VALIDATION', 400, 'branch is inactive');

  const [merchant] = await tx
    .select({ limit: schema.merchants.staffLimitPerBranch })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId));
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(schema.merchantStaff)
    .where(
      and(eq(schema.merchantStaff.branchId, branchId), eq(schema.merchantStaff.isActive, true)),
    );
  if (n >= (merchant?.limit ?? 0)) {
    throw new AppError(
      'STAFF_LIMIT_REACHED',
      409,
      'this branch already has its maximum number of staff',
    );
  }
}

// v1.0 org model (docs/architecture/v1-hld.md §3.1). Merchant-side management of
// branches and staff. Authorization is server-side: requireMerchantAdmin for every
// mutation, and staff only ever see their own branch.
export async function merchantOrgRoutes(app: FastifyInstance) {
  app.get('/v1/merchant/org/me', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    return { merchantId: m.merchantId, role: m.role, branchId: m.branchId, staffId: m.staffId };
  });

  app.get('/v1/merchant/org/branches', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    const scope =
      m.role === 'staff'
        ? and(
            eq(schema.merchantBranches.merchantId, m.merchantId),
            eq(schema.merchantBranches.id, m.branchId!),
          )
        : eq(schema.merchantBranches.merchantId, m.merchantId);
    const branches = await app.db
      .select()
      .from(schema.merchantBranches)
      .where(scope)
      .orderBy(asc(schema.merchantBranches.createdAt));
    const [merchant] = await app.db
      .select({ staffLimitPerBranch: schema.merchants.staffLimitPerBranch })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, m.merchantId));
    return { branches, staffLimitPerBranch: merchant?.staffLimitPerBranch ?? 0 };
  });

  app.post(
    '/v1/merchant/org/branches',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantBranchCreateBody } },
    async (req, reply) => {
      const m = req.merchantMember!;
      const body = req.body as MerchantBranchCreateBody;
      const branch = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.merchantBranches)
          .values({
            merchantId: m.merchantId,
            name: body.name,
            city: body.city,
            address: body.address,
          })
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_branch.create',
          resourceType: 'merchant_branch',
          resourceId: row!.id,
          after: row,
          request: req,
        });
        return row!;
      });
      return reply.code(201).send(branch);
    },
  );

  app.patch(
    '/v1/merchant/org/branches/:id',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantBranchUpdateBody } },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      const body = req.body as MerchantBranchUpdateBody;
      return app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.merchantBranches)
          .where(
            and(
              eq(schema.merchantBranches.id, id),
              eq(schema.merchantBranches.merchantId, m.merchantId),
            ),
          )
          .for('update');
        if (!existing) throw new AppError('NOT_FOUND', 404, 'branch not found');
        const [row] = await tx
          .update(schema.merchantBranches)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.merchantBranches.id, id))
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_branch.update',
          resourceType: 'merchant_branch',
          resourceId: id,
          before: existing,
          after: row,
          request: req,
        });
        return row!;
      });
    },
  );

  app.get('/v1/merchant/org/staff', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    const scope =
      m.role === 'staff'
        ? and(
            eq(schema.merchantStaff.merchantId, m.merchantId),
            eq(schema.merchantStaff.branchId, m.branchId!),
          )
        : eq(schema.merchantStaff.merchantId, m.merchantId);
    const staff = await app.db
      .select(staffSelect)
      .from(schema.merchantStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.merchantStaff.userId))
      .where(scope)
      .orderBy(asc(schema.merchantStaff.createdAt));
    return { staff };
  });

  app.post(
    '/v1/merchant/org/staff',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantStaffCreateBody } },
    async (req, reply) => {
      const m = req.merchantMember!;
      const body = req.body as MerchantStaffCreateBody;
      const passwordHash = await hashPassword(body.password);

      const created = await app.db.transaction(async (tx) => {
        await assertBranchHasStaffCapacity(tx, m.merchantId, body.branchId);

        // Never attach an existing account: a merchant admin must not be able to
        // claim someone else's AiVastra login by typing their email.
        const [taken] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          // /v1/auth/register does not lowercase, so an existing 'Alice@X.com' must
          // still collide with the (already lowercased) body.email.
          .where(sql`lower(${schema.users.email}) = ${body.email}`)
          .limit(1);
        if (taken) throw new AppError('CONFLICT', 409, 'an account with this email already exists');

        // emailVerified: the merchant admin vouches for the address; /v1/auth/login
        // refuses unverified email accounts.
        const [user] = await tx
          .insert(schema.users)
          .values({
            email: body.email,
            passwordHash,
            displayName: body.displayName,
            emailVerified: true,
          })
          .returning();
        // Every user-creation path seeds user_credits (see merchant/user-link.ts).
        await tx
          .insert(schema.userCredits)
          .values({ userId: user!.id, balance: 0 })
          .onConflictDoNothing();
        const [staff] = await tx
          .insert(schema.merchantStaff)
          .values({ merchantId: m.merchantId, branchId: body.branchId, userId: user!.id })
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_staff.create',
          resourceType: 'merchant_staff',
          resourceId: staff!.id,
          after: {
            branchId: staff!.branchId,
            userId: user!.id,
            email: body.email,
            displayName: body.displayName,
          },
          request: req,
        });
        return {
          id: staff!.id,
          branchId: staff!.branchId,
          userId: user!.id,
          email: user!.email,
          displayName: user!.displayName,
          isActive: staff!.isActive,
          createdAt: staff!.createdAt,
        };
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/v1/merchant/org/staff/:id',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantStaffUpdateBody } },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      const body = req.body as MerchantStaffUpdateBody;
      return updateStaff(app, req, id, body, {
        merchantId: m.merchantId,
        actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
      });
    },
  );
}

/**
 * Shared by the merchant-side and AiVastra-admin staff PATCH routes. Activating a
 * staff member, or moving an active one to another branch, consumes a seat in the
 * target branch, so it goes through assertBranchHasStaffCapacity.
 */
export async function updateStaff(
  app: FastifyInstance,
  req: Parameters<typeof recordAudit>[1]['request'],
  staffId: string,
  body: MerchantStaffUpdateBody,
  ctx: { merchantId: string; actor: { userId: string; role: string } },
) {
  return app.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.merchantStaff)
      .where(
        and(
          eq(schema.merchantStaff.id, staffId),
          eq(schema.merchantStaff.merchantId, ctx.merchantId),
        ),
      )
      .for('update');
    if (!existing) throw new AppError('NOT_FOUND', 404, 'staff not found');

    const targetBranch = body.branchId ?? existing.branchId;
    const willBeActive = body.isActive ?? existing.isActive;
    const consumesSeat = willBeActive && (!existing.isActive || targetBranch !== existing.branchId);
    if (consumesSeat) {
      await assertBranchHasStaffCapacity(tx, ctx.merchantId, targetBranch);
    } else if (targetBranch !== existing.branchId) {
      // No seat consumed (inactive member, or being deactivated while moved), so the
      // capacity check above never ran — but it is the only place the branch is tied
      // to this merchant. Without this a caller could write a foreign branch UUID.
      const [own] = await tx
        .select({ id: schema.merchantBranches.id })
        .from(schema.merchantBranches)
        .where(
          and(
            eq(schema.merchantBranches.id, targetBranch),
            eq(schema.merchantBranches.merchantId, ctx.merchantId),
          ),
        );
      if (!own) throw new AppError('NOT_FOUND', 404, 'branch not found');
    }

    const [row] = await tx
      .update(schema.merchantStaff)
      .set({ branchId: targetBranch, isActive: willBeActive, updatedAt: new Date() })
      .where(eq(schema.merchantStaff.id, staffId))
      .returning();
    await recordAudit(tx, {
      actor: ctx.actor,
      action: 'merchant_staff.update',
      resourceType: 'merchant_staff',
      resourceId: staffId,
      before: { branchId: existing.branchId, isActive: existing.isActive },
      after: { branchId: row!.branchId, isActive: row!.isActive },
      request: req,
    });
    // Return the same StaffRow shape as list/create, not the raw merchant_staff row
    // (which carries merchantId/updatedAt and lacks email/displayName).
    const [out] = await tx
      .select(staffSelect)
      .from(schema.merchantStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.merchantStaff.userId))
      .where(eq(schema.merchantStaff.id, staffId));
    return out!;
  });
}
