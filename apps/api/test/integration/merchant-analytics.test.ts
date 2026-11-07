import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestDevice,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// v1.0 step 3c analytics. Every number asserted below is hand-computed from the fixture in
// beforeAll; the arithmetic is written next to each expectation so a reviewer can redo it.

let c: Containers;
let app: TestApp;

// IST = UTC+05:30, no DST. Local midnight of day D in IST is (D-1) 18:30Z.
//   2026-09-30T18:29Z = 23:59 IST 30 Sep      2026-09-30T18:30Z = 00:00 IST 01 Oct
//   2026-10-01T18:29Z = 23:59 IST 01 Oct      2026-10-01T18:31Z = 00:01 IST 02 Oct
//   2026-10-03T18:30Z = 00:00 IST 04 Oct (first instant AFTER a window ending 2026-10-03)
const WINDOW = 'from=2026-10-01&to=2026-10-03';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;
let f: Fixture;

async function seedSession(v: {
  merchantId: string;
  branchId: string;
  deviceId: string;
  staffId: string | null;
  startedAt: string;
}) {
  const [row] = await app.db
    .insert(schema.instoreSessions)
    .values({
      merchantId: v.merchantId,
      branchId: v.branchId,
      deviceId: v.deviceId,
      staffId: v.staffId,
      mode: v.staffId ? 'assisted' : 'kiosk',
      startedAt: new Date(v.startedAt),
      lastActivityAt: new Date(v.startedAt),
    })
    .returning();
  return row!.id;
}

async function seedItem(
  sessionId: string,
  action: 'tried' | 'wishlisted' | 'sold',
  staffId: string | null,
  opts: { voided?: boolean; createdAt?: string; n?: number } = {},
) {
  for (let i = 0; i < (opts.n ?? 1); i++) {
    await app.db.insert(schema.sessionItems).values({
      sessionId,
      catalogItemId: randomUUID(),
      action,
      staffId,
      voidedAt: opts.voided ? new Date('2026-10-05T00:00:00Z') : null,
      createdAt: opts.createdAt ? new Date(opts.createdAt) : undefined,
    });
  }
}

async function seedJob(v: {
  merchantId: string;
  credits: number;
  createdAt: string;
  sessionId?: string;
  branchId?: string;
  deviceId?: string;
  staffId?: string;
  status?: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  /** Writes the job-keyed refund ledger row the dispatcher/API refund paths write. */
  refund?: { userId: string; reason: 'JOB_FAIL_REFUND' | 'REFUND_ADMIN_CANCEL' };
}) {
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      merchantId: v.merchantId,
      creditsCharged: v.credits,
      createdAt: new Date(v.createdAt),
      sessionId: v.sessionId ?? null,
      branchId: v.branchId ?? null,
      deviceId: v.deviceId ?? null,
      staffId: v.staffId ?? null,
      status: v.status ?? 'COMPLETED',
    })
    .returning({ id: schema.jobs.id });
  if (v.refund) {
    // Same shape as applyRefundTx: a full refund of credits_charged keyed by job id.
    await app.db.insert(schema.creditLedger).values({
      userId: v.refund.userId,
      delta: v.credits,
      reason: v.refund.reason,
      jobId: job!.id,
    });
  }
  return job!.id;
}

async function setDisplayName(userId: string, displayName: string | null) {
  await app.db.update(schema.users).set({ displayName }).where(sql`id = ${userId}`);
}

async function seedFixture() {
  // Owner balance 15 < LOW_CREDIT_THRESHOLD (20).
  const m = await createTestMerchant(app, { balance: 15 });
  const b1 = await createTestBranch(app, m.merchantId, { name: 'Branch One' });
  const b2 = await createTestBranch(app, m.merchantId, { name: 'Branch Two' });
  const staffA = await createTestStaff(app, m.merchantId, b1.id);
  const staffB = await createTestStaff(app, m.merchantId, b1.id);
  const staffC = await createTestStaff(app, m.merchantId, b2.id);
  const dev1 = await createTestDevice(app, m.merchantId, b1.id, { name: 'Counter 1' });
  const dev2 = await createTestDevice(app, m.merchantId, b2.id, { name: 'Counter 2' });
  await setDisplayName(staffA.userId, 'Asha');
  await setDisplayName(staffB.userId, 'Bilal');
  await setDisplayName(staffC.userId, 'Chen');
  // Active entities with NO activity anywhere: the breakdown must still list them (zeros).
  const b4 = await createTestBranch(app, m.merchantId, { name: 'Branch Four' });
  const staffF = await createTestStaff(app, m.merchantId, b2.id);
  await setDisplayName(staffF.userId, 'Farah');
  const devSpare = await createTestDevice(app, m.merchantId, b1.id, { name: 'Spare Tablet' });

  const s = (branchId: string, deviceId: string, staffId: string | null, startedAt: string) =>
    seedSession({ merchantId: m.merchantId, branchId, deviceId, staffId, startedAt });

  // Sessions                                             IST local start
  const S1 = await s(b1.id, dev1.deviceId, staffA.staffId, '2026-10-01T05:00:00Z'); // 01 Oct 10:30
  const S2 = await s(b1.id, dev1.deviceId, staffA.staffId, '2026-10-01T18:29:00Z'); // 01 Oct 23:59
  const S3 = await s(b1.id, dev1.deviceId, staffB.staffId, '2026-10-01T18:31:00Z'); // 02 Oct 00:01
  const S4 = await s(b1.id, dev1.deviceId, null, '2026-10-02T06:00:00Z'); //           02 Oct kiosk
  const S5 = await s(b2.id, dev2.deviceId, staffC.staffId, '2026-10-03T07:00:00Z'); // 03 Oct
  const S6 = await s(b1.id, dev1.deviceId, staffA.staffId, '2026-09-30T18:29:00Z'); // 30 Sep 23:59 (out)
  const S7 = await s(b1.id, dev1.deviceId, staffA.staffId, '2026-10-03T18:31:00Z'); // 04 Oct 00:01 (out)

  const A = staffA.staffId;
  const B = staffB.staffId;
  const C = staffC.staffId;
  // S1: tried×2 (A), wishlisted×1, sold×1 (A), sold×1 VOIDED (A)
  await seedItem(S1, 'tried', A, { n: 2 });
  await seedItem(S1, 'wishlisted', null);
  await seedItem(S1, 'sold', A);
  await seedItem(S1, 'sold', A, { voided: true });
  // S2: tried×1 (A), sold×1 (A) recorded AFTER the window: still counts (session start rules)
  await seedItem(S2, 'tried', A);
  await seedItem(S2, 'sold', A, { createdAt: '2026-10-06T10:00:00Z' });
  // S3: tried×1 (B), sold×1 (B), wishlisted×1
  await seedItem(S3, 'tried', B);
  await seedItem(S3, 'sold', B);
  await seedItem(S3, 'wishlisted', null);
  // S4 (kiosk, no staff): tried×2, wishlisted×1 — kiosk mode cannot sell
  await seedItem(S4, 'tried', null, { n: 2 });
  await seedItem(S4, 'wishlisted', null);
  // S5 (branch 2): tried×1 (C), sold×1 (C)
  await seedItem(S5, 'tried', C);
  await seedItem(S5, 'sold', C);
  // Out-of-window sessions: must never count
  await seedItem(S6, 'tried', A);
  await seedItem(S6, 'sold', A);
  await seedItem(S7, 'tried', A);

  const mid = m.merchantId;
  // Jobs. In-store (session set): 2 + 3 + 2 = 7 in window. Legacy (no session): 5 in window.
  await seedJob({
    merchantId: mid,
    credits: 2,
    createdAt: '2026-10-01T05:01:00Z',
    sessionId: S1,
    branchId: b1.id,
    deviceId: dev1.deviceId,
    staffId: A,
  }); // 01 Oct
  await seedJob({
    merchantId: mid,
    credits: 3,
    createdAt: '2026-10-01T18:32:00Z',
    sessionId: S3,
    branchId: b1.id,
    deviceId: dev1.deviceId,
    staffId: B,
  }); // 02 Oct 00:02
  await seedJob({
    merchantId: mid,
    credits: 2,
    createdAt: '2026-10-03T07:01:00Z',
    sessionId: S5,
    branchId: b2.id,
    deviceId: dev2.deviceId,
    staffId: C,
  }); // 03 Oct
  await seedJob({ merchantId: mid, credits: 5, createdAt: '2026-10-02T10:00:00Z' }); // legacy, 02 Oct
  // Boundary jobs just outside the window
  await seedJob({
    merchantId: mid,
    credits: 3,
    createdAt: '2026-09-30T18:29:59Z',
    sessionId: S6,
    branchId: b1.id,
    deviceId: dev1.deviceId,
    staffId: A,
  }); // 30 Sep 23:59:59
  await seedJob({ merchantId: mid, credits: 4, createdAt: '2026-10-03T18:30:00Z' }); // legacy, 04 Oct 00:00

  // 10 Oct IST (DAY10, outside WINDOW so none of the numbers above move): a branch that has
  // since been DEACTIVATED, with its (inactive) device and (inactive, nameless) staff member
  // D, plus refunded / failed jobs for the net-of-refund rule.
  const b3 = await createTestBranch(app, m.merchantId, {
    name: 'Branch Three (closed)',
    isActive: false,
  });
  const dev3 = await createTestDevice(app, m.merchantId, b3.id, {
    name: 'Closed Tablet',
    isActive: false,
  });
  const staffD = await createTestStaff(app, m.merchantId, b3.id, { isActive: false });
  await setDisplayName(staffD.userId, null); // name falls back to the email
  const [dUser] = await app.db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(sql`id = ${staffD.userId}`);
  // Still an active staff row, but in the deactivated branch: no analytics access, and not
  // listed by the breakdown (no activity, inactive branch).
  const staffE = await createTestStaff(app, m.merchantId, b3.id);
  const D = staffD.staffId;
  const S8 = await s(b3.id, dev3.deviceId, D, '2026-10-10T06:00:00Z'); // 10 Oct 11:30 IST
  // S8: tried×1 (D), sold×1 (D), wishlisted×1 (no item staff: credited to D via the session)
  await seedItem(S8, 'tried', D);
  await seedItem(S8, 'sold', D);
  await seedItem(S8, 'wishlisted', null);
  const at3 = { sessionId: S8, branchId: b3.id, deviceId: dev3.deviceId, staffId: D };
  // In-store 3 credits, FAILED and refunded (JOB_FAIL_REFUND +3) → contributes 0.
  await seedJob({
    merchantId: mid,
    credits: 3,
    createdAt: '2026-10-10T06:01:00Z',
    ...at3,
    status: 'FAILED',
    refund: { userId: m.userId, reason: 'JOB_FAIL_REFUND' },
  });
  // In-store 2 credits, FAILED but never refunded (no ledger row) → still counts 2.
  await seedJob({
    merchantId: mid,
    credits: 2,
    createdAt: '2026-10-10T06:02:00Z',
    ...at3,
    status: 'FAILED',
  });
  // Legacy 4 credits, CANCELLED and refunded (REFUND_ADMIN_CANCEL +4) → contributes 0.
  await seedJob({
    merchantId: mid,
    credits: 4,
    createdAt: '2026-10-10T07:00:00Z',
    status: 'CANCELLED',
    refund: { userId: m.userId, reason: 'REFUND_ADMIN_CANCEL' },
  });
  // Legacy 1 credit, completed → counts.
  await seedJob({ merchantId: mid, credits: 1, createdAt: '2026-10-10T08:00:00Z' });

  // A second merchant with activity in the same window: must never leak into M's numbers.
  const m2 = await createTestMerchant(app, { balance: 999 });
  const m2b = await createTestBranch(app, m2.merchantId);
  const m2s = await createTestStaff(app, m2.merchantId, m2b.id);
  const m2d = await createTestDevice(app, m2.merchantId, m2b.id);
  const X = await seedSession({
    merchantId: m2.merchantId,
    branchId: m2b.id,
    deviceId: m2d.deviceId,
    staffId: m2s.staffId,
    startedAt: '2026-10-02T05:00:00Z',
  });
  await seedItem(X, 'tried', m2s.staffId, { n: 4 });
  await seedItem(X, 'sold', m2s.staffId, { n: 2 });
  await seedJob({
    merchantId: m2.merchantId,
    credits: 9,
    createdAt: '2026-10-02T05:01:00Z',
    sessionId: X,
    branchId: m2b.id,
    deviceId: m2d.deviceId,
    staffId: m2s.staffId,
  });
  await seedJob({ merchantId: m2.merchantId, credits: 11, createdAt: '2026-10-02T05:02:00Z' });

  return {
    m,
    b1,
    b2,
    staffA,
    staffB,
    staffC,
    dev1,
    dev2,
    b3,
    b4,
    dev3,
    devSpare,
    staffD,
    staffDEmail: dUser!.email,
    staffE,
    staffF,
    m2,
    m2b,
    m2s,
    m2d,
    adminAuth: await memberAuthHeader(app, m.userId),
    m2AdminAuth: await memberAuthHeader(app, m2.userId),
  };
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  f = await seedFixture();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function summary(headers: Record<string, string>, qs: string) {
  return app.inject({ method: 'GET', url: `/v1/merchant/analytics/summary?${qs}`, headers });
}

async function timeseries(headers: Record<string, string>, qs: string) {
  return app.inject({ method: 'GET', url: `/v1/merchant/analytics/timeseries?${qs}`, headers });
}

async function breakdown(headers: Record<string, string>, qs: string) {
  return app.inject({ method: 'GET', url: `/v1/merchant/analytics/breakdown?${qs}`, headers });
}

// The deactivated-branch / refund day (10 Oct IST), outside WINDOW.
const DAY10 = 'from=2026-10-10&to=2026-10-10';

const METRIC_KEYS = [
  'sessions',
  'tried',
  'sold',
  'wishlisted',
  'conversion',
  'creditsSpent',
  'creditsBalance',
  'unattributed',
  'mine',
  'points',
  'rows',
];

/** A refused request must carry no figures at all, not even zeros. */
function expectNoMetrics(body: Record<string, unknown>) {
  for (const k of METRIC_KEYS) expect(body, k).not.toHaveProperty(k);
  expect(JSON.stringify(body)).not.toMatch(/:\s*\d/);
}

describe('GET /v1/merchant/analytics/summary — admin totals', () => {
  it('matches the hand-computed totals for the 3-day IST window', async () => {
    const res = await summary(f.adminAuth, WINDOW);
    expect(res.statusCode).toBe(200);
    // sessions: S1..S5 = 5 (S6 23:59 IST 30 Sep and S7 00:01 IST 04 Oct are outside)
    // tried: S1 2 + S2 1 + S3 1 + S4 2 + S5 1 = 7
    // wishlisted: S1 1 + S3 1 + S4 1 = 3
    // sold (not voided): S1 1 + S2 1 + S3 1 + S5 1 = 4 (S1's voided sale excluded)
    // conversion 4 / 5 = 0.8
    // creditsSpent: 2 + 3 + 2 = 7; legacy 1 job / 5 credits
    expect(res.json()).toEqual({
      window: { from: '2026-10-01', to: '2026-10-03', tz: 'Asia/Kolkata' },
      sessions: 5,
      tried: 7,
      sold: 4,
      wishlisted: 3,
      conversion: { sold: 4, sessions: 5, ratio: 0.8 },
      creditsSpent: 7,
      creditsBalance: 15,
      lowCreditThreshold: 20,
      lowCredit: true,
      unattributed: { jobs: 1, credits: 5 },
    });
    expect(res.json()).not.toHaveProperty('mine');
  });

  it('in-store credits plus the legacy line reconcile with all of the merchant job credits', async () => {
    const body = (await summary(f.adminAuth, WINDOW)).json();
    // Direct sum over jobs for M in [01 Oct 00:00 IST, 04 Oct 00:00 IST) = 2+3+2+5 = 12
    const rows = await app.db.execute<{ total: string }>(
      sql`select coalesce(sum(credits_charged), 0)::text as total from jobs
        where merchant_id = ${f.m.merchantId}
          and created_at >= '2026-09-30T18:30:00Z' and created_at < '2026-10-03T18:30:00Z'`,
    );
    const total = Number(rows[0]?.total);
    expect(total).toBe(12);
    expect(body.creditsSpent + body.unattributed.credits).toBe(total);
  });

  it('from=to is exactly one local IST day on each side of midnight', async () => {
    // 01 Oct IST: S1 (10:30) + S2 (23:59) = 2 sessions; S3 at 00:01 02 Oct is the next day.
    // tried S1 2 + S2 1 = 3; sold S1 1 + S2 1 = 2; wishlisted S1 1; credits J(2) only.
    const d1 = (await summary(f.adminAuth, 'from=2026-10-01&to=2026-10-01')).json();
    expect(d1).toMatchObject({
      sessions: 2,
      tried: 3,
      sold: 2,
      wishlisted: 1,
      creditsSpent: 2,
      unattributed: { jobs: 0, credits: 0 },
    });
    // 02 Oct IST: S3 (00:01) + S4 = 2; tried 1 + 2 = 3; sold 1; wishlisted 1 + 1 = 2;
    // credits: the 3-credit job at 00:02 IST; legacy 5.
    const d2 = (await summary(f.adminAuth, 'from=2026-10-02&to=2026-10-02')).json();
    expect(d2).toMatchObject({
      sessions: 2,
      tried: 3,
      sold: 1,
      wishlisted: 2,
      conversion: { sold: 1, sessions: 2, ratio: 0.5 },
      creditsSpent: 3,
      unattributed: { jobs: 1, credits: 5 },
    });
  });

  it('honours another timezone', async () => {
    // UTC day 01 Oct = [01 Oct 00:00Z, 02 Oct 00:00Z): S1 05:00Z, S2 18:29Z, S3 18:31Z = 3.
    const res = await summary(f.adminAuth, 'from=2026-10-01&to=2026-10-01&tz=UTC');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ window: { tz: 'UTC' }, sessions: 3 });
  });

  it('an empty window returns zeros and a 0 conversion, never null or NaN', async () => {
    const res = await summary(f.adminAuth, 'from=2025-01-01&to=2025-01-31');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessions: 0,
      tried: 0,
      sold: 0,
      wishlisted: 0,
      conversion: { sold: 0, sessions: 0, ratio: 0 },
      creditsSpent: 0,
      unattributed: { jobs: 0, credits: 0 },
    });
  });

  it('defaults to the last 30 days ending today in Asia/Kolkata', async () => {
    const res = await summary(f.adminAuth, '');
    expect(res.statusCode).toBe(200);
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    const today = fmt(new Date());
    const from = new Date(`${today}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    expect(res.json().window).toEqual({
      from: from.toISOString().slice(0, 10),
      to: today,
      tz: 'Asia/Kolkata',
    });
  });

  it('balance is the owner wallet and lowCredit flips at the threshold', async () => {
    expect((await summary(f.adminAuth, WINDOW)).json()).toMatchObject({
      creditsBalance: 15,
      lowCredit: true,
    });
    await f.m.credits(50);
    expect((await summary(f.adminAuth, WINDOW)).json()).toMatchObject({
      creditsBalance: 50,
      lowCreditThreshold: 20,
      lowCredit: false,
    });
    await f.m.credits(15);
  });
});

describe('GET /v1/merchant/analytics/summary — admin filters', () => {
  it('branch filter', async () => {
    // Branch 1: S1..S4 = 4 sessions; tried 2+1+1+2 = 6; sold 1+1+1 = 3; wishlisted 3;
    // credits 2 + 3 = 5; legacy jobs have no branch so the legacy line is 0.
    const res = await summary(f.adminAuth, `${WINDOW}&branchId=${f.b1.id}`);
    expect(res.json()).toMatchObject({
      sessions: 4,
      tried: 6,
      sold: 3,
      wishlisted: 3,
      creditsSpent: 5,
      unattributed: { jobs: 0, credits: 0 },
    });
  });

  it('device filter', async () => {
    // Device 2 = branch 2: S5 only; tried 1; sold 1; credits 2.
    const res = await summary(f.adminAuth, `${WINDOW}&deviceId=${f.dev2.deviceId}`);
    expect(res.json()).toMatchObject({
      sessions: 1,
      tried: 1,
      sold: 1,
      wishlisted: 0,
      creditsSpent: 2,
    });
  });

  it('staff filter: sessions by session.staff_id, items by session_items.staff_id', async () => {
    // Staff A: sessions S1, S2 = 2; tried (item staff A) 2 + 1 = 3; sold S1 1 + S2 1 = 2
    // (voided excluded); wishlisted = COALESCE(item staff, session staff) = A for S1's
    // wishlist → 1 (Task 3 ruling B1; was 0 in Task 2); credits the 2-credit job.
    const res = await summary(f.adminAuth, `${WINDOW}&staffId=${f.staffA.staffId}`);
    expect(res.json()).toMatchObject({
      sessions: 2,
      tried: 3,
      sold: 2,
      wishlisted: 1,
      creditsSpent: 2,
      unattributed: { jobs: 0, credits: 0 },
    });
  });

  it('wishlists are credited to the assisting staff member; kiosk wishlists to nobody', async () => {
    // Staff B: S3's wishlist (assisted by B) → 1. Staff C: S5 has no wishlist → 0.
    // The kiosk session S4's wishlist has no staff on the item or the session: nobody's.
    // A 1 + B 1 + C 0 = 2 of the 3 wishlisted in the window.
    const b = (await summary(f.adminAuth, `${WINDOW}&staffId=${f.staffB.staffId}`)).json();
    expect(b).toMatchObject({ sessions: 1, tried: 1, sold: 1, wishlisted: 1 });
    const cc = (await summary(f.adminAuth, `${WINDOW}&staffId=${f.staffC.staffId}`)).json();
    expect(cc).toMatchObject({ sessions: 1, tried: 1, sold: 1, wishlisted: 0 });
    // DAY10: D assisted S8, whose wishlist item has no staff id → credited to D.
    const d = (await summary(f.adminAuth, `${DAY10}&staffId=${f.staffD.staffId}`)).json();
    expect(d).toMatchObject({ sessions: 1, tried: 1, sold: 1, wishlisted: 1 });
  });

  it("another merchant's ids return zeros, not an error that would leak existence", async () => {
    for (const qs of [
      `branchId=${f.m2b.id}`,
      `staffId=${f.m2s.staffId}`,
      `deviceId=${f.m2d.deviceId}`,
      `branchId=${randomUUID()}`,
    ]) {
      const res = await summary(f.adminAuth, `${WINDOW}&${qs}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        sessions: 0,
        tried: 0,
        sold: 0,
        wishlisted: 0,
        creditsSpent: 0,
        unattributed: { jobs: 0, credits: 0 },
      });
    }
  });

  it('the second merchant sees only its own data', async () => {
    // M2: 1 session, tried 4, sold 2, credits 9, legacy 1 job / 11 credits, balance 999.
    const res = await summary(f.m2AdminAuth, WINDOW);
    expect(res.json()).toMatchObject({
      sessions: 1,
      tried: 4,
      sold: 2,
      wishlisted: 0,
      creditsSpent: 9,
      creditsBalance: 999,
      lowCredit: false,
      unattributed: { jobs: 1, credits: 11 },
    });
  });
});

describe('GET /v1/merchant/analytics/summary — staff scope', () => {
  it('staff totals are their branch, mine is their own rows, no wallet or legacy line', async () => {
    // Staff A (branch 1): branch totals as the branch-1 filter above.
    // mine: sessions S1, S2 = 2; tried 3; sold 2.
    const res = await summary(f.staffA.auth, WINDOW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      window: { from: '2026-10-01', to: '2026-10-03', tz: 'Asia/Kolkata' },
      sessions: 4,
      tried: 6,
      sold: 3,
      wishlisted: 3,
      conversion: { sold: 3, sessions: 4, ratio: 0.75 },
      creditsSpent: 5,
      creditsBalance: null,
      lowCreditThreshold: 20,
      lowCredit: false,
      unattributed: null,
      mine: { sessions: 2, tried: 3, sold: 2 },
    });
  });

  it('mine differs per staff member of the same branch', async () => {
    // Staff B: session S3 = 1; tried 1; sold 1.
    const res = await summary(f.staffB.auth, WINDOW);
    expect(res.json()).toMatchObject({ sessions: 4, mine: { sessions: 1, tried: 1, sold: 1 } });
  });

  it('own branch id, own staff id and own-branch device are allowed', async () => {
    expect((await summary(f.staffA.auth, `${WINDOW}&branchId=${f.b1.id}`)).statusCode).toBe(200);
    const own = await summary(f.staffA.auth, `${WINDOW}&staffId=${f.staffA.staffId}`);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ sessions: 2, tried: 3, sold: 2 });
    const dev = await summary(f.staffA.auth, `${WINDOW}&deviceId=${f.dev1.deviceId}`);
    expect(dev.statusCode).toBe(200);
    expect(dev.json()).toMatchObject({ sessions: 4 });
  });

  it('foreign branch, staff or device ids are 403', async () => {
    for (const qs of [
      `branchId=${f.b2.id}`,
      `branchId=${f.m2b.id}`,
      `staffId=${f.staffB.staffId}`,
      `staffId=${f.staffC.staffId}`,
      `deviceId=${f.dev2.deviceId}`,
      `deviceId=${f.m2d.deviceId}`,
      `deviceId=${randomUUID()}`,
    ]) {
      const res = await summary(f.staffA.auth, `${WINDOW}&${qs}`);
      expect(res.statusCode, qs).toBe(403);
      expectNoMetrics(res.json());
    }
  });

  it('deactivated staff are 403', async () => {
    const off = await createTestStaff(app, f.m.merchantId, f.b1.id, { isActive: false });
    const res = await summary(off.auth, WINDOW);
    expect(res.statusCode).toBe(403);
    expectNoMetrics(res.json());
  });

  it('an active staff member of a DEACTIVATED branch is 403 on every endpoint', async () => {
    for (const res of [
      await summary(f.staffE.auth, DAY10),
      await timeseries(f.staffE.auth, DAY10),
      await breakdown(f.staffE.auth, `${DAY10}&by=branch`),
      await breakdown(f.staffE.auth, `${DAY10}&by=staff`),
      await breakdown(f.staffE.auth, `${DAY10}&by=device`),
    ]) {
      expect(res.statusCode).toBe(403);
      expectNoMetrics(res.json());
    }
  });
});

describe('GET /v1/merchant/analytics/summary — auth and validation', () => {
  it('unauthenticated is 401, a non-member is 403', async () => {
    expect((await summary({}, WINDOW)).statusCode).toBe(401);
    const [u] = await app.db
      .insert(schema.users)
      .values({ email: `nobody-${randomUUID()}@test.com`, emailVerified: true })
      .returning();
    expect((await summary(await memberAuthHeader(app, u!.id), WINDOW)).statusCode).toBe(403);
  });

  it('rejects bad windows, ids and timezones with 400', async () => {
    for (const qs of [
      'from=2025-01-01&to=2026-01-02', // 367 days inclusive
      'from=2026-10-03&to=2026-10-01', // from > to
      'from=2026-02-30&to=2026-03-01', // not a calendar date
      'from=01-10-2026&to=2026-10-03', // wrong format
      'branchId=not-a-uuid',
      'staffId=123',
      'deviceId=zzz',
      'tz=Mars/Olympus',
      'tz=%2B05:30', // offsets are not IANA names
    ]) {
      const res = await summary(f.adminAuth, qs);
      expect(res.statusCode, qs).toBe(400);
    }
  });

  it('accepts exactly 366 days', async () => {
    // 2024 is a leap year: 01 Jan .. 31 Dec = 366 days inclusive.
    expect((await summary(f.adminAuth, 'from=2024-01-01&to=2024-12-31')).statusCode).toBe(200);
  });
});

describe('credits are net of refunds (Task 3 ruling B2)', () => {
  it('a refunded charge contributes 0; a failed but unrefunded charge still counts', async () => {
    // DAY10: in-store 3 (refunded) + 2 (FAILED, no refund row) → creditsSpent 2.
    // Legacy 4 (CANCELLED, refunded) + 1 (completed) → unattributed { jobs 1, credits 1 }.
    // S8: 1 session, tried 1, sold 1, wishlisted 1 (all in the deactivated branch).
    const res = await summary(f.adminAuth, DAY10);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessions: 1,
      tried: 1,
      sold: 1,
      wishlisted: 1,
      creditsSpent: 2,
      unattributed: { jobs: 1, credits: 1 },
    });
  });

  it('in-store + legacy reconcile with the merchant NET credits (charges minus job refunds)', async () => {
    // 01..10 Oct IST = [30 Sep 18:30Z, 10 Oct 18:30Z).
    // Charges: WINDOW 2+3+2+5 = 12, the 4-credit legacy job at 04 Oct 00:00 IST, DAY10
    // 3+2+4+1 = 10 → 26. Job refund rows: 3 + 4 = 7. Net = 19.
    // Endpoint: in-store 7 + 2 = 9; legacy 5 + 4 + 1 = 10 (3 jobs); 9 + 10 = 19.
    const body = (await summary(f.adminAuth, 'from=2026-10-01&to=2026-10-10')).json();
    expect(body).toMatchObject({ creditsSpent: 9, unattributed: { jobs: 3, credits: 10 } });
    const rows = await app.db.execute<{ charged: string; refunded: string }>(
      sql`select
          (select coalesce(sum(j.credits_charged), 0) from jobs j
            where j.merchant_id = ${f.m.merchantId}
              and j.created_at >= '2026-09-30T18:30:00Z' and j.created_at < '2026-10-10T18:30:00Z'
          )::text as charged,
          (select coalesce(sum(l.delta), 0) from credit_ledger l join jobs j on j.id = l.job_id
            where j.merchant_id = ${f.m.merchantId}
              and j.created_at >= '2026-09-30T18:30:00Z' and j.created_at < '2026-10-10T18:30:00Z'
              and l.delta > 0
          )::text as refunded`,
    );
    const net = Number(rows[0]?.charged) - Number(rows[0]?.refunded);
    expect(Number(rows[0]?.charged)).toBe(26);
    expect(net).toBe(19);
    expect(body.creditsSpent + body.unattributed.credits).toBe(net);
  });
});

describe('the legacy line under a filter (B3 i)', () => {
  it('a session-less job that still carries a branch id stays out of a filtered view', async () => {
    // jobs.session_id is ON DELETE SET NULL, so a job can keep branch/device/staff ids with
    // no session. 12 Oct IST (no other data): one such 6-credit job on branch 1.
    await seedJob({
      merchantId: f.m.merchantId,
      credits: 6,
      createdAt: '2026-10-12T06:00:00Z',
      branchId: f.b1.id,
      deviceId: f.dev1.deviceId,
      staffId: f.staffA.staffId,
    });
    const day = 'from=2026-10-12&to=2026-10-12';
    // Unfiltered: it is legacy (no session) → { jobs 1, credits 6 }; in-store 0.
    expect((await summary(f.adminAuth, day)).json()).toMatchObject({
      creditsSpent: 0,
      unattributed: { jobs: 1, credits: 6 },
    });
    // Filtered by its branch, device or staff: the legacy line is 0, and it is not in-store.
    for (const qs of [
      `branchId=${f.b1.id}`,
      `deviceId=${f.dev1.deviceId}`,
      `staffId=${f.staffA.staffId}`,
    ]) {
      expect((await summary(f.adminAuth, `${day}&${qs}`)).json(), qs).toMatchObject({
        creditsSpent: 0,
        unattributed: { jobs: 0, credits: 0 },
      });
    }
  });
});

describe('timezone validated against Postgres too (B3 ii)', () => {
  it('a name ICU accepts but Postgres does not is 400 on every endpoint, never 500', async () => {
    // US/Pacific-New: valid in ICU (Node's Intl), "not recognized" by Postgres 16.
    for (const res of [
      await summary(f.adminAuth, `${WINDOW}&tz=US/Pacific-New`),
      await timeseries(f.adminAuth, `${WINDOW}&tz=US/Pacific-New`),
      await breakdown(f.adminAuth, `${WINDOW}&by=branch&tz=US/Pacific-New`),
    ]) {
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('GET /v1/merchant/analytics/timeseries', () => {
  it('one zero-filled point per local IST day, ascending, with hand-computed values', async () => {
    // 30 Sep: S6 (23:59 IST) → 1 session, tried 1, sold 1.
    // 01 Oct: S1 + S2 (23:59 IST, 18:29Z) → 2; tried 2+1 = 3; sold 1+1 = 2 (voided excluded).
    // 02 Oct: S3 (00:01 IST, 18:31Z) + S4 → 2; tried 1+2 = 3; sold 1.
    // 03 Oct: S5 → 1; tried 1; sold 1.
    // 04 Oct: S7 (00:01 IST) → 1; tried 1; sold 0.
    const res = await timeseries(f.adminAuth, 'from=2026-09-30&to=2026-10-04&bucket=day');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      window: { from: '2026-09-30', to: '2026-10-04', tz: 'Asia/Kolkata' },
      points: [
        { date: '2026-09-30', sessions: 1, tried: 1, sold: 1 },
        { date: '2026-10-01', sessions: 2, tried: 3, sold: 2 },
        { date: '2026-10-02', sessions: 2, tried: 3, sold: 1 },
        { date: '2026-10-03', sessions: 1, tried: 1, sold: 1 },
        { date: '2026-10-04', sessions: 1, tried: 1, sold: 0 },
      ],
    });
  });

  it('zero-fills the days with no data', async () => {
    // 03 Oct S5 {1,1,1}; 04 Oct S7 {1,1,0}; 05..09 Oct nothing; 10 Oct S8 {1,1,1}.
    const res = await timeseries(f.adminAuth, 'from=2026-10-03&to=2026-10-10');
    const zero = (date: string) => ({ date, sessions: 0, tried: 0, sold: 0 });
    expect(res.json().points).toEqual([
      { date: '2026-10-03', sessions: 1, tried: 1, sold: 1 },
      { date: '2026-10-04', sessions: 1, tried: 1, sold: 0 },
      zero('2026-10-05'),
      zero('2026-10-06'),
      zero('2026-10-07'),
      zero('2026-10-08'),
      zero('2026-10-09'),
      { date: '2026-10-10', sessions: 1, tried: 1, sold: 1 },
    ]);
  });

  it('from=to yields exactly one point', async () => {
    const res = await timeseries(f.adminAuth, 'from=2026-10-01&to=2026-10-01');
    expect(res.json().points).toEqual([{ date: '2026-10-01', sessions: 2, tried: 3, sold: 2 }]);
  });

  it('buckets in the requested tz', async () => {
    // UTC 01 Oct: S1 05:00Z, S2 18:29Z, S3 18:31Z → 3; tried 2+1+1 = 4; sold 1+1+1 = 3.
    // UTC 02 Oct: S4 06:00Z → 1; tried 2; sold 0 (kiosk).
    const res = await timeseries(f.adminAuth, 'from=2026-10-01&to=2026-10-02&tz=UTC');
    expect(res.json()).toEqual({
      window: { from: '2026-10-01', to: '2026-10-02', tz: 'UTC' },
      points: [
        { date: '2026-10-01', sessions: 3, tried: 4, sold: 3 },
        { date: '2026-10-02', sessions: 1, tried: 2, sold: 0 },
      ],
    });
  });

  it('a 366-day window has 366 points, and a DST zone still gets one point per day', async () => {
    const year = (await timeseries(f.adminAuth, 'from=2024-01-01&to=2024-12-31')).json();
    expect(year.points).toHaveLength(366);
    expect(year.points[0]).toEqual({ date: '2024-01-01', sessions: 0, tried: 0, sold: 0 });
    expect(year.points[365].date).toBe('2024-12-31');
    // 08 Mar 2026 is a 23-hour day in New York.
    const ny = (
      await timeseries(f.adminAuth, 'from=2026-03-07&to=2026-03-09&tz=America/New_York')
    ).json();
    expect(ny.points.map((p: { date: string }) => p.date)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });

  it('honours the admin filters', async () => {
    // Branch 2 only: 03 Oct S5 {1,1,1}.
    const b2 = (await timeseries(f.adminAuth, `${WINDOW}&branchId=${f.b2.id}`)).json();
    expect(b2.points).toEqual([
      { date: '2026-10-01', sessions: 0, tried: 0, sold: 0 },
      { date: '2026-10-02', sessions: 0, tried: 0, sold: 0 },
      { date: '2026-10-03', sessions: 1, tried: 1, sold: 1 },
    ]);
    // Staff A: sessions S1, S2 on 01 Oct; items by item staff: tried 3, sold 2 on 01 Oct.
    const a = (await timeseries(f.adminAuth, `${WINDOW}&staffId=${f.staffA.staffId}`)).json();
    expect(a.points).toEqual([
      { date: '2026-10-01', sessions: 2, tried: 3, sold: 2 },
      { date: '2026-10-02', sessions: 0, tried: 0, sold: 0 },
      { date: '2026-10-03', sessions: 0, tried: 0, sold: 0 },
    ]);
    // Another merchant's branch: zeros, not an error.
    const foreign = await timeseries(f.adminAuth, `${WINDOW}&branchId=${f.m2b.id}`);
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().points.every((p: { sessions: number }) => p.sessions === 0)).toBe(true);
  });

  it('a staff caller sees only their branch; foreign ids are 403 with no figures', async () => {
    // Staff A → branch 1: 01 Oct {2,3,2}; 02 Oct {2,3,1}; 03 Oct (S5 is branch 2) zeros.
    const res = await timeseries(f.staffA.auth, WINDOW);
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([
      { date: '2026-10-01', sessions: 2, tried: 3, sold: 2 },
      { date: '2026-10-02', sessions: 2, tried: 3, sold: 1 },
      { date: '2026-10-03', sessions: 0, tried: 0, sold: 0 },
    ]);
    for (const qs of [
      `branchId=${f.b2.id}`,
      `staffId=${f.staffB.staffId}`,
      `deviceId=${f.dev2.deviceId}`,
      `deviceId=${f.m2d.deviceId}`,
    ]) {
      const r = await timeseries(f.staffA.auth, `${WINDOW}&${qs}`);
      expect(r.statusCode, qs).toBe(403);
      expectNoMetrics(r.json());
    }
  });

  it('bucket other than day and bad windows are 400', async () => {
    for (const qs of [
      `${WINDOW}&bucket=week`,
      `${WINDOW}&bucket=hour`,
      'from=2025-01-01&to=2026-01-02',
      'tz=Mars/Olympus',
    ]) {
      expect((await timeseries(f.adminAuth, qs)).statusCode, qs).toBe(400);
    }
    expect((await timeseries({}, WINDOW)).statusCode).toBe(401);
  });
});

type Row = {
  id: string;
  name: string;
  sessions: number;
  tried: number;
  sold: number;
  wishlisted: number;
  conversion: { sold: number; sessions: number; ratio: number };
  creditsSpent: number;
};

function row(
  id: string,
  name: string,
  v: [sessions: number, tried: number, sold: number, wishlisted: number, credits: number],
): Row {
  const [sessions, tried, sold, wishlisted, creditsSpent] = v;
  return {
    id,
    name,
    sessions,
    tried,
    sold,
    wishlisted,
    conversion: { sold, sessions, ratio: sessions > 0 ? sold / sessions : 0 },
    creditsSpent,
  };
}

describe('GET /v1/merchant/analytics/breakdown — admin', () => {
  it('by=branch: every active branch (zeros included), sorted by name', async () => {
    // Branch One: S1..S4 → sessions 4, tried 6, sold 3, wishlisted 3, credits 2+3 = 5.
    // Branch Two: S5 → 1, 1, 1, 0, credits 2. Branch Four: no activity → zeros.
    // Branch Three (closed): deactivated and nothing in WINDOW → not listed.
    const res = await breakdown(f.adminAuth, `${WINDOW}&by=branch`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      by: 'branch',
      rows: [
        row(f.b4.id, 'Branch Four', [0, 0, 0, 0, 0]),
        row(f.b1.id, 'Branch One', [4, 6, 3, 3, 5]),
        row(f.b2.id, 'Branch Two', [1, 1, 1, 0, 2]),
      ],
    });
  });

  it('by=staff: sessions by session staff, tried/sold by item staff, wishlists via COALESCE', async () => {
    // Asha (A): S1, S2 → 2; tried 3; sold 2; wishlisted S1 → 1; credits 2.
    // Bilal (B): S3 → 1; tried 1; sold 1; wishlisted S3 → 1; credits 3.
    // Chen (C): S5 → 1; tried 1; sold 1; wishlisted 0; credits 2.
    // Farah: no activity → zeros. Kiosk S4 (1 session, 2 tried, 1 wishlisted) is nobody's.
    // D (inactive, no WINDOW activity), E (branch closed), M2's staff → not listed.
    const res = await breakdown(f.adminAuth, `${WINDOW}&by=staff`);
    expect(res.json()).toEqual({
      by: 'staff',
      rows: [
        row(f.staffA.staffId, 'Asha', [2, 3, 2, 1, 2]),
        row(f.staffB.staffId, 'Bilal', [1, 1, 1, 1, 3]),
        row(f.staffC.staffId, 'Chen', [1, 1, 1, 0, 2]),
        row(f.staffF.staffId, 'Farah', [0, 0, 0, 0, 0]),
      ],
    });
  });

  it('by=device: sessions and credits to the device', async () => {
    // Counter 1 (dev1) = branch 1's figures; Counter 2 (dev2) = branch 2's; Spare Tablet zeros.
    const res = await breakdown(f.adminAuth, `${WINDOW}&by=device`);
    expect(res.json()).toEqual({
      by: 'device',
      rows: [
        row(f.dev1.deviceId, 'Counter 1', [4, 6, 3, 3, 5]),
        row(f.dev2.deviceId, 'Counter 2', [1, 1, 1, 0, 2]),
        row(f.devSpare.deviceId, 'Spare Tablet', [0, 0, 0, 0, 0]),
      ],
    });
  });

  it("a deactivated branch, device and staff member's activity still appears", async () => {
    // DAY10: S8 in the closed branch / closed tablet / staff D (no display name → email):
    // 1 session, tried 1, sold 1, wishlisted 1, credits 2 (3 refunded excluded, 2 counted).
    const z: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const v: [number, number, number, number, number] = [1, 1, 1, 1, 2];
    expect((await breakdown(f.adminAuth, `${DAY10}&by=branch`)).json().rows).toEqual([
      row(f.b4.id, 'Branch Four', z),
      row(f.b1.id, 'Branch One', z),
      row(f.b3.id, 'Branch Three (closed)', v),
      row(f.b2.id, 'Branch Two', z),
    ]);
    expect((await breakdown(f.adminAuth, `${DAY10}&by=device`)).json().rows).toEqual([
      row(f.dev3.deviceId, 'Closed Tablet', v),
      row(f.dev1.deviceId, 'Counter 1', z),
      row(f.dev2.deviceId, 'Counter 2', z),
      row(f.devSpare.deviceId, 'Spare Tablet', z),
    ]);
    expect((await breakdown(f.adminAuth, `${DAY10}&by=staff`)).json().rows).toEqual([
      row(f.staffA.staffId, 'Asha', z),
      row(f.staffB.staffId, 'Bilal', z),
      row(f.staffC.staffId, 'Chen', z),
      row(f.staffF.staffId, 'Farah', z),
      row(f.staffD.staffId, f.staffDEmail, v),
    ]);
  });

  it('filters narrow the rows (branch → staff drill-down)', async () => {
    // Branch 1's staff: Asha and Bilal, same figures as above.
    const res = await breakdown(f.adminAuth, `${WINDOW}&by=staff&branchId=${f.b1.id}`);
    expect(res.json().rows).toEqual([
      row(f.staffA.staffId, 'Asha', [2, 3, 2, 1, 2]),
      row(f.staffB.staffId, 'Bilal', [1, 1, 1, 1, 3]),
    ]);
    const dev = await breakdown(f.adminAuth, `${WINDOW}&by=device&branchId=${f.b2.id}`);
    expect(dev.json().rows).toEqual([row(f.dev2.deviceId, 'Counter 2', [1, 1, 1, 0, 2])]);
  });

  it("another merchant's ids return 200 and no figures of theirs", async () => {
    const res = await breakdown(f.adminAuth, `${WINDOW}&by=staff&branchId=${f.m2b.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ by: 'staff', rows: [] });
    const dev = await breakdown(f.adminAuth, `${WINDOW}&by=device&deviceId=${f.m2d.deviceId}`);
    expect(dev.statusCode).toBe(200);
    expect(dev.json()).toEqual({ by: 'device', rows: [] });
    // M2's own admin sees only M2's entities.
    const m2 = (await breakdown(f.m2AdminAuth, `${WINDOW}&by=branch`)).json();
    expect(m2.rows).toHaveLength(1);
    expect(m2.rows[0]).toMatchObject({ id: f.m2b.id, sessions: 1, tried: 4, sold: 2 });
    expect(m2.rows[0].creditsSpent).toBe(9);
  });

  it('missing or invalid by, and bad windows, are 400', async () => {
    for (const qs of [
      WINDOW,
      `${WINDOW}&by=`,
      `${WINDOW}&by=merchant`,
      `${WINDOW}&by=BRANCH`,
      'from=2026-10-03&to=2026-10-01&by=branch',
      'by=staff&staffId=nope',
    ]) {
      expect((await breakdown(f.adminAuth, qs)).statusCode, qs).toBe(400);
    }
    expect((await breakdown({}, `${WINDOW}&by=branch`)).statusCode).toBe(401);
  });
});

describe('GET /v1/merchant/analytics/breakdown — staff scope', () => {
  it('by=staff returns only the caller row', async () => {
    const res = await breakdown(f.staffA.auth, `${WINDOW}&by=staff`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      by: 'staff',
      rows: [row(f.staffA.staffId, 'Asha', [2, 3, 2, 1, 2])],
    });
    // Staff B likewise sees only Bilal.
    const b = (await breakdown(f.staffB.auth, `${WINDOW}&by=staff`)).json();
    expect(b.rows).toEqual([row(f.staffB.staffId, 'Bilal', [1, 1, 1, 1, 3])]);
  });

  it('by=branch returns only their branch, by=device only their branch devices', async () => {
    expect((await breakdown(f.staffA.auth, `${WINDOW}&by=branch`)).json().rows).toEqual([
      row(f.b1.id, 'Branch One', [4, 6, 3, 3, 5]),
    ]);
    expect((await breakdown(f.staffA.auth, `${WINDOW}&by=device`)).json().rows).toEqual([
      row(f.dev1.deviceId, 'Counter 1', [4, 6, 3, 3, 5]),
      row(f.devSpare.deviceId, 'Spare Tablet', [0, 0, 0, 0, 0]),
    ]);
    // Staff C (branch 2): only Counter 2.
    expect((await breakdown(f.staffC.auth, `${WINDOW}&by=device`)).json().rows).toEqual([
      row(f.dev2.deviceId, 'Counter 2', [1, 1, 1, 0, 2]),
    ]);
  });

  it('foreign branch, staff or device ids are 403 with no figures', async () => {
    for (const qs of [
      `by=branch&branchId=${f.b2.id}`,
      `by=staff&staffId=${f.staffB.staffId}`,
      `by=staff&staffId=${f.m2s.staffId}`,
      `by=device&deviceId=${f.dev2.deviceId}`,
      `by=device&deviceId=${f.m2d.deviceId}`,
      `by=device&deviceId=${randomUUID()}`,
    ]) {
      const res = await breakdown(f.staffA.auth, `${WINDOW}&${qs}`);
      expect(res.statusCode, qs).toBe(403);
      expectNoMetrics(res.json());
    }
  });
});
