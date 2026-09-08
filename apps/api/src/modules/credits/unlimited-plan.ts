import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

export type UnlimitedPlanRow = typeof schema.unlimitedPlans.$inferSelect;

/**
 * Live date check against `now()`, not a trust of `status` alone — so
 * enforcement never has a timing gap waiting for the hourly reminder
 * scheduler to flip a lapsed row's `status` to 'expired'. The scheduler does
 * flip `status` for clean admin-facing history, but correctness here doesn't
 * depend on it having run yet.
 */
export async function getActiveUnlimitedPlan(
  tx: DB,
  userId: string,
): Promise<UnlimitedPlanRow | null> {
  const [row] = await tx
    .select()
    .from(schema.unlimitedPlans)
    .where(
      and(
        eq(schema.unlimitedPlans.userId, userId),
        eq(schema.unlimitedPlans.status, 'active'),
        lte(schema.unlimitedPlans.startAt, sql`now()`),
        gte(schema.unlimitedPlans.endAt, sql`now()`),
      ),
    );
  return row ?? null;
}

/**
 * Most recently updated unlimited-plan row for this user, regardless of
 * status — used by the self-serve renewal flow, which (unlike
 * getActiveUnlimitedPlan) must also find an *expired* plan to recharge, not
 * just a currently-active one. Excludes nothing itself; callers decide what
 * to do with a 'revoked' row (renewal should refuse — see
 * unlimited-plan-renewal.ts).
 */
export async function getLatestUnlimitedPlan(
  tx: DB,
  userId: string,
): Promise<UnlimitedPlanRow | null> {
  const [row] = await tx
    .select()
    .from(schema.unlimitedPlans)
    .where(eq(schema.unlimitedPlans.userId, userId))
    .orderBy(desc(schema.unlimitedPlans.updatedAt))
    .limit(1);
  return row ?? null;
}

export type UnlimitedPlanDisplayStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'revoked'
  | 'none';

export interface UnlimitedPlanDisplay {
  status: UnlimitedPlanDisplayStatus;
  startAt: string | null;
  endAt: string | null;
  daysRemaining: number | null;
  note: string | null;
  pricePaise: number | null;
  queueStream: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_WINDOW_DAYS = 3;

/**
 * Single source of truth for "what badge/status does this user's plan show" —
 * used by the admin user-detail route and the user-facing /v1/credits route.
 * Derives 'expired' from the live end date rather than trusting a possibly
 * stale `status` column, matching getActiveUnlimitedPlan's enforcement check.
 */
export function deriveDisplayStatus(plan: UnlimitedPlanRow | null): UnlimitedPlanDisplay {
  if (!plan) {
    return {
      status: 'none',
      startAt: null,
      endAt: null,
      daysRemaining: null,
      note: null,
      pricePaise: null,
      queueStream: null,
    };
  }
  const base = {
    startAt: plan.startAt.toISOString(),
    endAt: plan.endAt.toISOString(),
    note: plan.note,
    pricePaise: plan.pricePaise,
    queueStream: plan.queueStream,
  };
  if (plan.status === 'revoked') {
    return { ...base, status: 'revoked', daysRemaining: null };
  }
  const daysRemaining = Math.ceil((plan.endAt.getTime() - Date.now()) / DAY_MS);
  if (daysRemaining < 0) {
    return { ...base, status: 'expired', daysRemaining: 0 };
  }
  if (daysRemaining <= EXPIRING_SOON_WINDOW_DAYS) {
    return { ...base, status: 'expiring_soon', daysRemaining };
  }
  return { ...base, status: 'active', daysRemaining };
}
