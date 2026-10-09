import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCheckPurchasePayment,
  adminReviewPurchasePayment,
} from '../../src/modules/admin/shopify-purchases.routes.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let storeA: typeof schema.shopifyStores.$inferSelect;
let storeB: typeof schema.shopifyStores.$inferSelect;
let adminUserId: string;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;
const MIN = 60_000;
const HOUR = 60 * MIN;

const fakeRequest = { id: 'req-1', ip: '127.0.0.1', headers: {} } as unknown as FastifyRequest;

async function makeStore(domain: string, shopId: number) {
  const [s] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: domain,
      shopifyShopId: shopId,
      accessToken: 'enc:token',
      scope: 'read_products',
    })
    .returning();
  return s;
}

async function purchase(overrides: Partial<Row> = {}, forStore = storeA): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: forStore.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${4000 + seq}`,
      paymentStatus: 'UNVERIFIED',
      ...overrides,
    })
    .returning();
  return row;
}

async function reload(row: Row): Promise<Row> {
  const [fresh] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, row.id));
  return fresh;
}

async function auditRows(row: Row) {
  return app.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.resourceId, row.id),
        eq(schema.auditLogs.action, 'shopify_purchase.payment_review'),
      ),
    );
}

const actor = () => ({ userId: adminUserId, role: 'SUPER_ADMIN' });

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  storeA = await makeStore('admin-list-a.myshopify.com', 700000001);
  storeB = await makeStore('admin-list-b.myshopify.com', 700000002);
  // adminAuthHeader creates a real admin user; recover its id for direct calls.
  await adminAuthHeader(app, 'SUPER_ADMIN');
  const [u] = await app.db
    .select({ id: schema.adminUsers.userId })
    .from(schema.adminUsers)
    .limit(1);
  adminUserId = u.id;
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('GET /admin/shopify/purchases', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/shopify/purchases' });
    expect(res.statusCode).toBe(401);
  });

  it('lists only approved manual purchases, newest first, with store domain and filters', async () => {
    const paid = await purchase({
      paymentStatus: 'PAID',
      createdAt: new Date(Date.now() - 3 * HOUR),
    });
    const notReceived = await purchase({
      paymentStatus: 'NOT_RECEIVED',
      createdAt: new Date(Date.now() - 2 * HOUR),
    });
    const other = await purchase({ paymentStatus: 'UNVERIFIED' }, storeB);
    await purchase({ status: 'PENDING', paymentStatus: 'NOT_REQUIRED' }); // never approved: hidden
    await purchase({ source: 'autorefill', paymentStatus: 'NOT_REQUIRED' }); // auto-refill: hidden

    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const all = (
      await app.inject({ method: 'GET', url: '/admin/shopify/purchases?limit=100', headers })
    ).json();
    const ids = all.purchases.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([paid.id, notReceived.id, other.id]));
    expect(all.purchases.every((p: { status: string }) => p.status === 'ACTIVE')).toBe(true);
    expect(all.purchases.find((p: { id: string }) => p.id === other.id).shopDomain).toBe(
      'admin-list-b.myshopify.com',
    );
    // newest first
    const times = all.purchases.map((p: { createdAt: string }) => new Date(p.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const byStatus = (
      await app.inject({
        method: 'GET',
        url: '/admin/shopify/purchases?paymentStatus=NOT_RECEIVED&limit=100',
        headers,
      })
    ).json();
    expect(
      byStatus.purchases.every(
        (p: { paymentStatus: string }) => p.paymentStatus === 'NOT_RECEIVED',
      ),
    ).toBe(true);
    expect(byStatus.purchases.map((p: { id: string }) => p.id)).toContain(notReceived.id);

    const byStore = (
      await app.inject({
        method: 'GET',
        url: `/admin/shopify/purchases?storeId=${storeB.id}&limit=100`,
        headers,
      })
    ).json();
    expect(byStore.purchases.map((p: { id: string }) => p.id)).toEqual([other.id]);

    const byQuery = (
      await app.inject({
        method: 'GET',
        url: '/admin/shopify/purchases?q=admin-list-b&limit=100',
        headers,
      })
    ).json();
    expect(byQuery.purchases.map((p: { id: string }) => p.id)).toEqual([other.id]);
  });

  it('needsAttention returns NOT_RECEIVED, stale UNVERIFIED and annotated rows only', async () => {
    const stale = await purchase({
      paymentStatus: 'UNVERIFIED',
      createdAt: new Date(Date.now() - 5 * HOUR),
    });
    const fresh = await purchase({ paymentStatus: 'UNVERIFIED', createdAt: new Date() });
    const noted = await purchase({
      paymentStatus: 'PAID',
      paymentNote: 'checked with the merchant',
    });
    const clean = await purchase({ paymentStatus: 'PAID' });

    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = (
      await app.inject({
        method: 'GET',
        url: '/admin/shopify/purchases?needsAttention=true&limit=100',
        headers,
      })
    ).json();
    const ids = res.purchases.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([stale.id, noted.id]));
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(clean.id);
  });

  it('paginates with a cursor', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const first = (
      await app.inject({ method: 'GET', url: '/admin/shopify/purchases?limit=2', headers })
    ).json();
    expect(first.purchases).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await app.inject({
        method: 'GET',
        url: `/admin/shopify/purchases?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        headers,
      })
    ).json();
    const firstIds = first.purchases.map((p: { id: string }) => p.id);
    expect(second.purchases.every((p: { id: string }) => !firstIds.includes(p.id))).toBe(true);
  });

  it('rejects an unknown payment status', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/shopify/purchases?paymentStatus=BOGUS',
      headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('payment review', () => {
  it('marks a purchase PAID by hand: records the note, reviewer and an audit row, and touches no credits', async () => {
    const row = await purchase();
    const ledgerBefore = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.storeId, storeA.id));

    const out = await adminReviewPurchasePayment(
      app,
      row.id,
      { status: 'PAID', note: 'seen in the Partner Dashboard' },
      actor(),
      fakeRequest,
    );

    expect(out.paymentStatus).toBe('PAID');
    const fresh = await reload(row);
    expect(fresh).toMatchObject({
      paymentStatus: 'PAID',
      paymentStatusSource: 'MANUAL',
      paymentNote: 'seen in the Partner Dashboard',
      paymentFlaggedBy: adminUserId,
      nextPaymentCheckAt: null,
    });
    expect(fresh.paidAt).not.toBeNull();
    expect(fresh.paymentFlaggedAt).not.toBeNull();
    const audit = await auditRows(row);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: adminUserId,
      resourceType: 'shopify_credit_purchases',
    });
    const ledgerAfter = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.storeId, storeA.id));
    expect(ledgerAfter).toHaveLength(ledgerBefore.length);
  });

  it('marks NOT_RECEIVED with no paid_at, and a note alone keeps the status', async () => {
    const row = await purchase();
    await adminReviewPurchasePayment(
      app,
      row.id,
      { status: 'NOT_RECEIVED', note: 'invoice failed' },
      actor(),
      fakeRequest,
    );
    let fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paidAt).toBeNull();

    await adminReviewPurchasePayment(
      app,
      row.id,
      { note: 'merchant contacted on whatsapp' },
      actor(),
      fakeRequest,
    );
    fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paymentStatusSource).toBe('MANUAL');
    expect(fresh.paymentNote).toBe('merchant contacted on whatsapp');
    expect(await auditRows(row)).toHaveLength(2);
  });

  it('AUTO clears an override and queues an immediate re-check; without an override it is a 409', async () => {
    const row = await purchase();
    await expect(
      adminReviewPurchasePayment(
        app,
        row.id,
        { status: 'AUTO', note: 'nothing to clear' },
        actor(),
        fakeRequest,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    await adminReviewPurchasePayment(
      app,
      row.id,
      { status: 'PAID', note: 'manual first' },
      actor(),
      fakeRequest,
    );
    await adminReviewPurchasePayment(
      app,
      row.id,
      { status: 'AUTO', note: 'let the system decide' },
      actor(),
      fakeRequest,
    );
    const fresh = await reload(row);
    expect(fresh).toMatchObject({
      paymentStatus: 'UNVERIFIED',
      paymentStatusSource: 'AUTO',
      paidAt: null,
    });
    expect(fresh.nextPaymentCheckAt).not.toBeNull();
  });

  it('refuses a held (hold-until-paid) purchase with 409 and changes nothing', async () => {
    const row = await purchase({ paymentStatus: 'AWAITING' });
    await expect(
      adminReviewPurchasePayment(
        app,
        row.id,
        { status: 'PAID', note: 'trying to force it' },
        actor(),
        fakeRequest,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
    expect(await auditRows(row)).toHaveLength(0);
  });

  it('returns 404 for an unknown purchase', async () => {
    await expect(
      adminReviewPurchasePayment(
        app,
        '00000000-0000-0000-0000-000000000000',
        { note: 'no such row' },
        actor(),
        fakeRequest,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rolls everything back when the reviewer cannot be recorded (no such admin user)', async () => {
    const row = await purchase();
    await expect(
      adminReviewPurchasePayment(
        app,
        row.id,
        { status: 'PAID', note: 'should not stick' },
        { userId: '00000000-0000-0000-0000-00000000dead', role: 'SUPER_ADMIN' },
        fakeRequest,
      ),
    ).rejects.toThrow();
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.paymentNote).toBeNull();
    expect(await auditRows(row)).toHaveLength(0);
  });

  it('over HTTP: 403 without credits.write, 400 for a too-short note, 200 and the new status otherwise', async () => {
    const row = await purchase();
    const support = await adminAuthHeader(app, 'SUPPORT');
    const forbidden = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: support,
      payload: { status: 'PAID', note: 'support cannot do this' },
    });
    expect(forbidden.statusCode).toBe(403);

    const admin = await adminAuthHeader(app, 'SUPER_ADMIN');
    const short = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: admin,
      payload: { status: 'PAID', note: 'x' },
    });
    expect(short.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: admin,
      payload: { status: 'NOT_RECEIVED', note: 'invoice failed in billing' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().paymentStatus).toBe('NOT_RECEIVED');
    expect((await reload(row)).paymentStatusSource).toBe('MANUAL');
  });
});

describe('check payment on a granted purchase', () => {
  const saleFor = (row: Row) => async () =>
    new Map([
      [
        (row.shopifyChargeId as string).split('/').pop() as string,
        { paidAt: new Date('2026-10-09T06:39:29Z') },
      ],
    ]);

  it('confirms an UNVERIFIED purchase as PAID without granting or auditing', async () => {
    const row = await purchase();
    const out = await adminCheckPurchasePayment(app, row.id, actor(), fakeRequest, {
      fetchSales: saleFor(row),
    });
    expect(out.paymentStatus).toBe('PAID');
    const ledger = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.externalRef, `shopify_pack:${row.shopifyChargeId}`));
    expect(ledger).toHaveLength(0);
  });

  it('refuses a manually overridden purchase with 409', async () => {
    const row = await purchase({ paymentStatus: 'NOT_RECEIVED', paymentStatusSource: 'MANUAL' });
    await expect(
      adminCheckPurchasePayment(app, row.id, actor(), fakeRequest, { fetchSales: saleFor(row) }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await reload(row)).paymentStatus).toBe('NOT_RECEIVED');
  });
});
