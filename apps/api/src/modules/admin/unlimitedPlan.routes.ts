import { schema } from '@aivastra/db';
import { GrantUnlimitedPlanBody, OfferUnlimitedPlanBody } from '@aivastra/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { deriveDisplayStatus } from '../credits/unlimited-plan.js';
import { recordAudit } from './audit.js';
import { requireAdmin, requirePermission } from './guard.js';

/**
 * Reuses the existing credits.read/credits.write permissions rather than
 * seeding new ones — granting/revoking an unlimited plan is a credits-adjacent
 * admin action, and this avoids an extra permission-seed migration for now.
 */
/**
 * What the admin sees as "this user's monthly plan": the active plan, else an
 * open price offer. Old expired/revoked rows stay out, as before, so the
 * editor's "grant a new plan" path is unchanged for them.
 */
export async function getAdminVisiblePlan(app: FastifyInstance, userId: string) {
  const [row] = await app.db
    .select()
    .from(schema.unlimitedPlans)
    .where(
      and(
        eq(schema.unlimitedPlans.userId, userId),
        inArray(schema.unlimitedPlans.status, ['active', 'offered']),
      ),
    )
    .orderBy(sql`case ${schema.unlimitedPlans.status} when 'active' then 0 else 1 end`)
    .limit(1);
  return row ?? null;
}

export async function adminUnlimitedPlanRoutes(app: FastifyInstance) {
  const READ = requirePermission('credits.read');
  const WRITE = requirePermission('credits.write');
  // Agreed prices are a pricing decision, not support work: role-gated to Super Admin
  // and Admin rather than the credits.write permission, which support-facing roles
  // may hold for routine credit adjustments.
  const PRICING = requireAdmin(['SUPER_ADMIN', 'ADMIN']);

  app.get(
    '/admin/users/:id/unlimited-plan',
    { preHandler: READ, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const plan = await getAdminVisiblePlan(app, id);
      const charges = await app.db
        .select({
          id: schema.unlimitedPlanCharges.id,
          pricePaise: schema.unlimitedPlanCharges.pricePaise,
          chargeType: schema.unlimitedPlanCharges.chargeType,
          chargedAt: schema.unlimitedPlanCharges.chargedAt,
        })
        .from(schema.unlimitedPlanCharges)
        .where(eq(schema.unlimitedPlanCharges.userId, id))
        .orderBy(desc(schema.unlimitedPlanCharges.chargedAt))
        .limit(20);
      return { ...deriveDisplayStatus(plan ?? null), charges };
    },
  );

  app.post(
    '/admin/users/:id/unlimited-plan',
    {
      preHandler: WRITE,
      schema: { params: z.object({ id: z.string().uuid() }), body: GrantUnlimitedPlanBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { startAt, endAt, note, pricePaise, queueStream } = req.body as z.infer<
        typeof GrantUnlimitedPlanBody
      >;

      const [user] = await app.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');

      const plan = await app.db.transaction(async (tx) => {
        const [existingActive] = await tx
          .select()
          .from(schema.unlimitedPlans)
          .where(
            and(eq(schema.unlimitedPlans.userId, id), eq(schema.unlimitedPlans.status, 'active')),
          )
          .for('update');

        let row: typeof schema.unlimitedPlans.$inferSelect;
        if (existingActive) {
          // Re-grant while active: edit the row in place and reset the
          // reminder stage so a user already told "3 days left" is re-armed
          // if the new endAt pushes the deadline back out.
          const [updated] = await tx
            .update(schema.unlimitedPlans)
            .set({
              startAt: new Date(startAt),
              endAt: new Date(endAt),
              note: note ?? null,
              pricePaise,
              queueStream,
              lastReminderStage: 'none',
              updatedAt: new Date(),
            })
            .where(eq(schema.unlimitedPlans.id, existingActive.id))
            .returning();
          row = updated!;
        } else {
          const [inserted] = await tx
            .insert(schema.unlimitedPlans)
            .values({
              userId: id,
              startAt: new Date(startAt),
              endAt: new Date(endAt),
              note: note ?? null,
              pricePaise,
              queueStream,
              grantedBy: req.userId,
            })
            .returning();
          row = inserted!;
        }

        // Every grant charges the configured price again — the first grant is
        // 'initial', re-granting/extending an already-active plan is treated
        // as a 'renewal'. Internal record only (no GST invoice — this is a
        // negotiated deal, not a self-serve purchase), see the table comment
        // on unlimitedPlanCharges.
        // A direct grant supersedes any open offer. Closing it here means a payment
        // still in flight for that offer extends this plan instead of trying to
        // activate a second one (see applyUnlimitedPlanRenewalPayment).
        await tx
          .update(schema.unlimitedPlans)
          .set({ status: 'revoked', revokedBy: req.userId, revokedAt: new Date() })
          .where(
            and(eq(schema.unlimitedPlans.userId, id), eq(schema.unlimitedPlans.status, 'offered')),
          );

        await tx.insert(schema.unlimitedPlanCharges).values({
          unlimitedPlanId: row.id,
          userId: id,
          pricePaise,
          chargeType: existingActive ? 'renewal' : 'initial',
          chargedBy: req.userId,
        });

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: existingActive ? 'unlimited_plan.extend' : 'unlimited_plan.grant',
          resourceType: 'unlimited_plan',
          resourceId: row.id,
          before: existingActive ?? null,
          after: row,
          request: req,
        });

        return row;
      });

      return deriveDisplayStatus(plan);
    },
  );

  // Sets (or changes) the agreed price this user pays for their own monthly plan.
  // Nothing is granted: the user pays from the pricing page, and that payment
  // starts the plan. Refused while a plan is active — edit that plan instead, so
  // there's never an offer and an active plan competing for the same payment.
  app.post(
    '/admin/users/:id/unlimited-plan/offer',
    {
      preHandler: PRICING,
      schema: { params: z.object({ id: z.string().uuid() }), body: OfferUnlimitedPlanBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { pricePaise, durationDays, note, queueStream } = req.body as z.infer<
        typeof OfferUnlimitedPlanBody
      >;

      const [user] = await app.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');

      const plan = await app.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.unlimitedPlans)
          .where(
            and(
              eq(schema.unlimitedPlans.userId, id),
              inArray(schema.unlimitedPlans.status, ['active', 'offered']),
            ),
          )
          .for('update');
        const active = rows.find((r) => r.status === 'active');
        if (active && active.endAt.getTime() > Date.now()) {
          throw new AppError(
            'CONFLICT',
            409,
            'user already has an active monthly plan — edit that plan instead',
          );
        }
        const existingOffer = rows.find((r) => r.status === 'offered');

        const now = new Date();
        if (active) {
          // Lapsed but not yet flipped by the hourly tick. Close it now, or the offer's
          // payment would extend this old plan (at its old length) instead.
          await tx
            .update(schema.unlimitedPlans)
            .set({ status: 'expired', updatedAt: now })
            .where(eq(schema.unlimitedPlans.id, active.id));
        }
        let row: typeof schema.unlimitedPlans.$inferSelect;
        if (existingOffer) {
          const [updated] = await tx
            .update(schema.unlimitedPlans)
            .set({ pricePaise, durationDays, note: note ?? null, queueStream, updatedAt: now })
            .where(eq(schema.unlimitedPlans.id, existingOffer.id))
            .returning();
          row = updated!;
        } else {
          // startAt/endAt are placeholders until the first payment sets the real window.
          const [inserted] = await tx
            .insert(schema.unlimitedPlans)
            .values({
              userId: id,
              status: 'offered',
              startAt: now,
              endAt: now,
              pricePaise,
              durationDays,
              note: note ?? null,
              queueStream,
              grantedBy: req.userId,
            })
            .returning();
          row = inserted!;
        }

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: existingOffer ? 'unlimited_plan.offer_update' : 'unlimited_plan.offer',
          resourceType: 'unlimited_plan',
          resourceId: row.id,
          before: existingOffer ?? null,
          after: row,
          request: req,
        });
        return row;
      });

      return deriveDisplayStatus(plan);
    },
  );

  app.post(
    '/admin/users/:id/unlimited-plan/offer/cancel',
    { preHandler: PRICING, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      await app.db.transaction(async (tx) => {
        const [offer] = await tx
          .select()
          .from(schema.unlimitedPlans)
          .where(
            and(eq(schema.unlimitedPlans.userId, id), eq(schema.unlimitedPlans.status, 'offered')),
          )
          .for('update');
        if (!offer) throw new AppError('NOT_FOUND', 404, 'user has no open price offer');
        const now = new Date();
        await tx
          .update(schema.unlimitedPlans)
          .set({ status: 'revoked', revokedBy: req.userId, revokedAt: now, updatedAt: now })
          .where(eq(schema.unlimitedPlans.id, offer.id));
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'unlimited_plan.offer_cancel',
          resourceType: 'unlimited_plan',
          resourceId: offer.id,
          before: offer,
          request: req,
        });
      });
      return { ok: true };
    },
  );

  app.post(
    '/admin/users/:id/unlimited-plan/revoke',
    { preHandler: WRITE, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };

      await app.db.transaction(async (tx) => {
        const [existingActive] = await tx
          .select()
          .from(schema.unlimitedPlans)
          .where(
            and(eq(schema.unlimitedPlans.userId, id), eq(schema.unlimitedPlans.status, 'active')),
          )
          .for('update');
        if (!existingActive)
          throw new AppError('NOT_FOUND', 404, 'user has no active monthly plan');

        await tx
          .update(schema.unlimitedPlans)
          .set({
            status: 'revoked',
            revokedBy: req.userId,
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.unlimitedPlans.id, existingActive.id));

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'unlimited_plan.revoke',
          resourceType: 'unlimited_plan',
          resourceId: existingActive.id,
          before: existingActive,
          request: req,
        });
      });

      return { ok: true };
    },
  );
}
