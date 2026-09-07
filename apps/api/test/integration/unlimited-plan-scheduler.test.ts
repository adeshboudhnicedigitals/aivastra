import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkUnlimitedPlanReminderOnLogin,
  runUnlimitedPlanReminderTick,
} from '../../src/modules/credits/unlimited-plan-scheduler.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let sent: Array<{ to: string; stage: string; daysRemaining: number }>;

const deps = () => ({
  sendEmail: async (
    _app: unknown,
    to: string,
    params: { stage: string; daysRemaining: number },
  ) => {
    sent.push({ to, stage: params.stage, daysRemaining: params.daysRemaining });
  },
});

async function seedPlan(opts: {
  email: string | null;
  daysUntilEnd: number;
  lastReminderStage?: string;
  isBanned?: boolean;
}) {
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: opts.email,
      displayName: 'Unlimited Plan Scheduler Test User',
      tier: 'free',
      emailVerified: true,
      isBanned: opts.isBanned ?? false,
    })
    .returning();
  const [plan] = await app.db
    .insert(schema.unlimitedPlans)
    .values({
      userId: user.id,
      startAt: new Date(Date.now() - 30 * DAY_MS),
      endAt: new Date(Date.now() + opts.daysUntilEnd * DAY_MS),
      lastReminderStage: opts.lastReminderStage ?? 'none',
      grantedBy: user.id,
    })
    .returning();
  return { user, plan };
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
});

beforeEach(() => {
  sent = [];
});

afterEach(async () => {
  await app.db.delete(schema.unlimitedPlans);
  await app.db.delete(schema.users);
});

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('unlimited plan reminder scheduler', () => {
  it('sends the 7-day reminder once daysRemaining crosses into the window', async () => {
    const { plan } = await seedPlan({ email: 'seven@example.com', daysUntilEnd: 6 });
    await runUnlimitedPlanReminderTick(app, deps());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('seven@example.com');
    expect(sent[0]?.stage).toBe('seven_day');

    const [row] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    expect(row?.lastReminderStage).toBe('seven_day');
  });

  it('does not send anything for a plan with more than 7 days remaining', async () => {
    await seedPlan({ email: 'plenty@example.com', daysUntilEnd: 10 });
    await runUnlimitedPlanReminderTick(app, deps());
    expect(sent).toEqual([]);
  });

  it('escalates straight to the 3-day reminder without re-sending the 7-day one', async () => {
    const { plan } = await seedPlan({
      email: 'three@example.com',
      daysUntilEnd: 2,
      lastReminderStage: 'seven_day',
    });
    await runUnlimitedPlanReminderTick(app, deps());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.stage).toBe('three_day');

    const [row] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    expect(row?.lastReminderStage).toBe('three_day');
  });

  it('does not re-send the same stage on a later tick', async () => {
    await seedPlan({
      email: 'already-told@example.com',
      daysUntilEnd: 2,
      lastReminderStage: 'three_day',
    });
    await runUnlimitedPlanReminderTick(app, deps());
    expect(sent).toEqual([]);
  });

  it('re-arms after an admin extends endAt (lastReminderStage reset to none)', async () => {
    const { plan } = await seedPlan({
      email: 'extended@example.com',
      daysUntilEnd: 20,
      lastReminderStage: 'none',
    });
    // Simulate the admin extend route resetting the stage after already
    // having warned this user once under the old (shorter) end date.
    await app.db
      .update(schema.unlimitedPlans)
      .set({ endAt: new Date(Date.now() + 3 * DAY_MS), lastReminderStage: 'none' })
      .where(eq(schema.unlimitedPlans.id, plan.id));

    await runUnlimitedPlanReminderTick(app, deps());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.stage).toBe('three_day');
  });

  it('flips a lapsed plan to expired and sends the expired email', async () => {
    const { plan } = await seedPlan({ email: 'lapsed@example.com', daysUntilEnd: -1 });
    await runUnlimitedPlanReminderTick(app, deps());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('lapsed@example.com');
    expect(sent[0]?.stage).toBe('expired');

    const [row] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    expect(row?.status).toBe('expired');
    expect(row?.lastReminderStage).toBe('expired');
  });

  it('does not re-send the expired email on a later tick once already flipped', async () => {
    // Once flipped to 'expired', the plan drops out of the status='active'
    // query the tick reads from — so a second tick call is a no-op for it.
    await seedPlan({
      email: 'already-expired@example.com',
      daysUntilEnd: -1,
      lastReminderStage: 'expired',
    });
    await runUnlimitedPlanReminderTick(app, deps());
    expect(sent).toEqual([]);
  });

  it('does not send an expired email to a banned user, but still flips status', async () => {
    const { plan } = await seedPlan({
      email: 'lapsed-banned@example.com',
      daysUntilEnd: -1,
      isBanned: true,
    });
    await runUnlimitedPlanReminderTick(app, deps());

    expect(sent).toEqual([]);
    const [row] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    expect(row?.status).toBe('expired');
  });

  it('does not send to a banned user or a user with no email', async () => {
    await seedPlan({ email: 'banned@example.com', daysUntilEnd: 2, isBanned: true });
    await seedPlan({ email: null, daysUntilEnd: 2 });
    await runUnlimitedPlanReminderTick(app, deps());
    expect(sent).toEqual([]);
  });
});

describe('checkUnlimitedPlanReminderOnLogin', () => {
  it('sends and shows a popup for a plan inside the 7-day window', async () => {
    const { user } = await seedPlan({ email: 'login-seven@example.com', daysUntilEnd: 6 });
    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());

    expect(result.show).toBe(true);
    expect(result.stage).toBe('seven_day');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.stage).toBe('seven_day');
  });

  it('sends and shows a popup for an expired plan, even though lastReminderStage is already at the top rank', async () => {
    const { user } = await seedPlan({
      email: 'login-expired@example.com',
      daysUntilEnd: -2,
      lastReminderStage: 'expired',
    });
    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());

    expect(result.show).toBe(true);
    expect(result.stage).toBe('expired');
    // Unconditional on this path — resends even though the rank is already
    // at 'expired', unlike the hourly tick which would skip it.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.stage).toBe('expired');
  });

  it('re-sends on a second call — no throttling yet, by design', async () => {
    const { user } = await seedPlan({ email: 'login-repeat@example.com', daysUntilEnd: 2 });
    await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());
    await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());
    expect(sent).toHaveLength(2);
  });

  it('does not show a popup or send for a plan with more than 7 days remaining', async () => {
    const { user } = await seedPlan({ email: 'login-plenty@example.com', daysUntilEnd: 20 });
    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());

    expect(result.show).toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not show a popup for a user with no unlimited plan', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: 'login-none@example.com',
        displayName: 'No Plan User',
        tier: 'free',
        emailVerified: true,
      })
      .returning();
    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());
    expect(result.show).toBe(false);
  });

  it('does not show a popup for a revoked plan', async () => {
    const { user, plan } = await seedPlan({ email: 'login-revoked@example.com', daysUntilEnd: 2 });
    await app.db
      .update(schema.unlimitedPlans)
      .set({ status: 'revoked' })
      .where(eq(schema.unlimitedPlans.id, plan.id));

    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());
    expect(result.show).toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not send an email (but still reports show: true) for a banned user', async () => {
    const { user } = await seedPlan({
      email: 'login-banned@example.com',
      daysUntilEnd: 2,
      isBanned: true,
    });
    const result = await checkUnlimitedPlanReminderOnLogin(app, user.id, deps());
    expect(result.show).toBe(true);
    expect(sent).toEqual([]);
  });
});
