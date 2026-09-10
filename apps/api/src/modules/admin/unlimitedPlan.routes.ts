import { schema } from '@aivastra/db';
import { GrantUnlimitedPlanBody } from '@aivastra/types';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { deriveDisplayStatus } from '../credits/unlimited-plan.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

/**
 * Reuses the existing credits.read/credits.write permissions rather than
 * seeding new ones — granting/revoking an unlimited plan is a credits-adjacent
 * admin action, and this avoids an extra permission-seed migration for now.
 */
export async function adminUnlimitedPlanRoutes(app: FastifyInstance) {
  const READ = requirePermission('credits.read');
  const WRITE = requirePermission('credits.write');

  app.get(
    '/admin/users/:id/unlimited-plan',
    { preHandler: READ, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [plan] = await app.db
        .select()
        .from(schema.unlimitedPlans)
        .where(
          and(eq(schema.unlimitedPlans.userId, id), eq(schema.unlimitedPlans.status, 'active')),
        );
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
