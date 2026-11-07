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
}) {
  await app.db.insert(schema.jobs).values({
    merchantId: v.merchantId,
    creditsCharged: v.credits,
    createdAt: new Date(v.createdAt),
    sessionId: v.sessionId ?? null,
    branchId: v.branchId ?? null,
    deviceId: v.deviceId ?? null,
    staffId: v.staffId ?? null,
    status: 'COMPLETED',
  });
}

async function seedFixture() {
  // Owner balance 15 < LOW_CREDIT_THRESHOLD (20).
  const m = await createTestMerchant(app, { balance: 15 });
  const b1 = await createTestBranch(app, m.merchantId, { name: 'Branch One' });
  const b2 = await createTestBranch(app, m.merchantId, { name: 'Branch Two' });
  const staffA = await createTestStaff(app, m.merchantId, b1.id);
  const staffB = await createTestStaff(app, m.merchantId, b1.id);
  const staffC = await createTestStaff(app, m.merchantId, b2.id);
  const dev1 = await createTestDevice(app, m.merchantId, b1.id);
  const dev2 = await createTestDevice(app, m.merchantId, b2.id);

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
    // (voided excluded); wishlisted items carry no staff = 0; credits the 2-credit job.
    const res = await summary(f.adminAuth, `${WINDOW}&staffId=${f.staffA.staffId}`);
    expect(res.json()).toMatchObject({
      sessions: 2,
      tried: 3,
      sold: 2,
      wishlisted: 0,
      creditsSpent: 2,
      unattributed: { jobs: 0, credits: 0 },
    });
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
    }
  });

  it('deactivated staff are 403', async () => {
    const off = await createTestStaff(app, f.m.merchantId, f.b1.id, { isActive: false });
    expect((await summary(off.auth, WINDOW)).statusCode).toBe(403);
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
