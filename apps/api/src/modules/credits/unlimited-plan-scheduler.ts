import { schema } from '@aivastra/db';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { UnlimitedPlanReminderStage } from '../../lib/mailer.js';
import { sendUnlimitedPlanReminderEmail } from '../../lib/mailer.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderStage = 'none' | UnlimitedPlanReminderStage;

/**
 * Escalation-rank map, same shape as ALERT_LEVEL_RANK
 * (apps/api/src/modules/shopify/runway.ts) — lets the tick ask "is this
 * worse than what we last told them?" numerically. Adding another stage
 * later is one more entry here, one more mailer template, and one more
 * branch in targetStageFor — not a redesign.
 */
export const REMINDER_STAGE_RANK: Record<ReminderStage, number> = {
  none: 0,
  seven_day: 1,
  three_day: 2,
  expired: 3,
};

export function targetStageFor(daysRemaining: number): ReminderStage {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 3) return 'three_day';
  if (daysRemaining <= 7) return 'seven_day';
  return 'none';
}

export function normalizeStage(value: string): ReminderStage {
  return value === 'seven_day' || value === 'three_day' || value === 'expired' ? value : 'none';
}

interface TickDeps {
  sendEmail?: (
    app: FastifyInstance,
    to: string,
    params: { stage: UnlimitedPlanReminderStage; endDateLabel: string; daysRemaining: number },
  ) => Promise<void>;
}

async function defaultSendEmail(
  app: FastifyInstance,
  to: string,
  params: { stage: UnlimitedPlanReminderStage; endDateLabel: string; daysRemaining: number },
): Promise<void> {
  await sendUnlimitedPlanReminderEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, to, params);
}

function endDateLabel(endAt: Date): string {
  return endAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Sends 7-day / 3-day / expired reminders to users on an active unlimited
 * plan, and flips a lapsed row's `status` to 'expired' for clean admin
 * history. Enforcement (apps/api/src/modules/credits/unlimited-plan.ts)
 * already checks the live end date itself, so this flip is bookkeeping, not
 * what stops access.
 */
export async function runUnlimitedPlanReminderTick(
  app: FastifyInstance,
  deps: TickDeps = {},
): Promise<void> {
  const sendEmail = deps.sendEmail ?? defaultSendEmail;

  const activePlans = await app.db
    .select({
      id: schema.unlimitedPlans.id,
      userId: schema.unlimitedPlans.userId,
      endAt: schema.unlimitedPlans.endAt,
      lastReminderStage: schema.unlimitedPlans.lastReminderStage,
      email: schema.users.email,
      isBanned: schema.users.isBanned,
    })
    .from(schema.unlimitedPlans)
    .innerJoin(schema.users, eq(schema.users.id, schema.unlimitedPlans.userId))
    .where(eq(schema.unlimitedPlans.status, 'active'));

  for (const plan of activePlans) {
    try {
      const daysRemaining = Math.ceil((plan.endAt.getTime() - Date.now()) / DAY_MS);
      const targetStage = targetStageFor(daysRemaining);
      const currentStage = normalizeStage(plan.lastReminderStage);
      const shouldNotify =
        targetStage !== 'none' &&
        REMINDER_STAGE_RANK[targetStage] > REMINDER_STAGE_RANK[currentStage];

      if (shouldNotify) {
        if (!plan.email || plan.isBanned) {
          app.log.warn(
            { planId: plan.id, userId: plan.userId },
            'unlimited-plan reminder not sent — no email on record or user is banned',
          );
        } else {
          await sendEmail(app, plan.email, {
            stage: targetStage,
            endDateLabel: endDateLabel(plan.endAt),
            daysRemaining,
          });
          await app.db
            .update(schema.unlimitedPlans)
            .set({ lastReminderStage: targetStage, updatedAt: new Date() })
            .where(eq(schema.unlimitedPlans.id, plan.id));
          app.log.info(
            { planId: plan.id, userId: plan.userId, targetStage },
            'unlimited-plan reminder sent',
          );
        }
      }

      // Flip status regardless of whether the email above actually sent — a
      // banned user or one with no email still shouldn't linger 'active'
      // forever once their end date has passed.
      if (targetStage === 'expired') {
        await app.db
          .update(schema.unlimitedPlans)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.unlimitedPlans.id, plan.id));
      }
    } catch (err) {
      app.log.error(
        { err, planId: plan.id, userId: plan.userId },
        'unlimited-plan reminder tick failed',
      );
    }
  }
}

export interface UnlimitedPlanLoginReminder {
  show: boolean;
  stage: UnlimitedPlanReminderStage | null;
  daysRemaining: number | null;
  endDateLabel: string | null;
}

/**
 * On-login force-check for one user: unconditionally (re)sends the matching
 * reminder email and returns a payload the web app uses to show a popup, if
 * the user's plan is within the 7-day/3-day/expired window right now.
 *
 * Deliberately ignores `lastReminderStage` for its own gating — ships this
 * way on purpose so every login re-sends the mail/popup for easy testing.
 * TODO: once testing is done, throttle this to once (or twice) a day instead
 * of every login — likely by checking a new `lastLoginReminderSentAt`
 * timestamp column before calling this, rather than changing this function's
 * shape.
 */
export async function checkUnlimitedPlanReminderOnLogin(
  app: FastifyInstance,
  userId: string,
  deps: TickDeps = {},
): Promise<UnlimitedPlanLoginReminder> {
  const sendEmail = deps.sendEmail ?? defaultSendEmail;

  const [row] = await app.db
    .select({
      id: schema.unlimitedPlans.id,
      endAt: schema.unlimitedPlans.endAt,
      status: schema.unlimitedPlans.status,
      email: schema.users.email,
      isBanned: schema.users.isBanned,
    })
    .from(schema.unlimitedPlans)
    .innerJoin(schema.users, eq(schema.users.id, schema.unlimitedPlans.userId))
    .where(eq(schema.unlimitedPlans.userId, userId))
    .orderBy(desc(schema.unlimitedPlans.updatedAt))
    .limit(1);

  const none: UnlimitedPlanLoginReminder = {
    show: false,
    stage: null,
    daysRemaining: null,
    endDateLabel: null,
  };
  if (!row || row.status === 'revoked') return none;

  const daysRemaining = Math.ceil((row.endAt.getTime() - Date.now()) / DAY_MS);
  const stage = targetStageFor(daysRemaining);
  if (stage === 'none') return none;

  const label = endDateLabel(row.endAt);

  if (row.email && !row.isBanned) {
    // Non-fatal by design (same pattern as maybeSendReceipt in
    // modules/payments/routes.ts) — a Resend outage or misconfiguration must
    // never stop the popup from showing. Without this try/catch, a thrown
    // send error propagates out of the route handler as a 500, and the web
    // app's login-check call silently swallows that failure — so the popup
    // (and every future one, since the frontend only calls this once per
    // mount) never appears at all, for a completely unrelated reason.
    try {
      await sendEmail(app, row.email, { stage, endDateLabel: label, daysRemaining });
      // Kept in sync so the hourly tick doesn't duplicate this same-stage
      // email later — harmless either way since this path ignores the
      // column itself.
      await app.db
        .update(schema.unlimitedPlans)
        .set({ lastReminderStage: stage, updatedAt: new Date() })
        .where(eq(schema.unlimitedPlans.id, row.id));
    } catch (err) {
      app.log.error(
        { err, userId, planId: row.id },
        'unlimited-plan login-check reminder email failed',
      );
    }
  }

  return { show: true, stage, daysRemaining, endDateLabel: label };
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Call once after `app.listen(...)`. Mirrors startUserLowCreditAlertScheduler's shape. */
export function startUnlimitedPlanReminderScheduler(
  app: FastifyInstance,
  intervalMs: number = ONE_HOUR_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('unlimited-plan reminder tick still running — skipping this interval');
      return;
    }
    running = true;
    void runUnlimitedPlanReminderTick(app)
      .catch((err) => {
        app.log.error({ err }, 'unlimited-plan reminder tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
