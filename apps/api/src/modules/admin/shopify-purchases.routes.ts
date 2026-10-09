import { schema } from '@aivastra/db';
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { type FetchOneTimeSales, PartnerApiError } from '../shopify/partner-api.js';
import { checkPurchases } from '../shopify/payment-settlement.js';
import { verifyGrantedPurchases, verifyWindowMs } from '../shopify/payment-verification.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const PAYMENT_STATUSES = [
  'NOT_REQUIRED',
  'UNVERIFIED',
  'PAID',
  'NOT_RECEIVED',
  'AWAITING',
  'UNPAID',
] as const;
/** Purchases whose credits were granted — the only ones an admin may review. */
const GRANTED_STATUSES = ['NOT_REQUIRED', 'UNVERIFIED', 'PAID', 'NOT_RECEIVED'] as const;

const P = schema.shopifyCreditPurchases;

const ListQuery = z.object({
  paymentStatus: z.string().optional(),
  storeId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  needsAttention: z.enum(['true', 'false']).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ReviewBody = z.object({
  status: z.enum(['PAID', 'NOT_RECEIVED', 'AUTO']).optional(),
  note: z.string().trim().min(3).max(500),
});
export type ReviewBodyInput = z.infer<typeof ReviewBody>;

/**
 * Core of POST /admin/shopify/purchases/:id/check-payment, exported so tests can
 * drive it with an injected Partner API fetch. Held rows (AWAITING/UNPAID) settle
 * and may grant; granted rows (UNVERIFIED/NOT_RECEIVED) are only verified — no
 * grant, no audit, because nothing about the credits changes. A row an admin
 * overrode is refused: the override would just be undone otherwise.
 */
export async function adminCheckPurchasePayment(
  app: FastifyInstance,
  purchaseId: string,
  actor: { userId: string; role: string },
  request: FastifyRequest,
  deps: { fetchSales?: FetchOneTimeSales } = {},
): Promise<{ paymentStatus: string }> {
  const load = async () => {
    const [r] = await app.db.select().from(P).where(eq(P.id, purchaseId)).limit(1);
    return r;
  };
  const row = await load();
  if (!row) throw new AppError('NOT_FOUND', 404, 'purchase not found');

  const verifying = row.paymentStatus === 'UNVERIFIED' || row.paymentStatus === 'NOT_RECEIVED';
  if (verifying && row.paymentStatusSource === 'MANUAL') {
    throw new AppError('CONFLICT', 409, 'status was set by an admin — clear the override first');
  }
  if (!verifying && row.paymentStatus !== 'AWAITING' && row.paymentStatus !== 'UNPAID') {
    return { paymentStatus: row.paymentStatus };
  }

  // Same scoping as the merchant confirm path: one store's sales, not the org's.
  const [store] = await app.db
    .select({ shopDomain: schema.shopifyStores.shopDomain })
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, row.storeId))
    .limit(1);

  // Both checkers log and swallow per-row failures so one bad row can't abandon a
  // batch. For a single admin action that would turn a failed settlement (which
  // correctly rolled back) into a silent 200, so remember the first failure and
  // re-raise it.
  let rowError: unknown;
  const onRowError = (_r: unknown, err: unknown) => {
    rowError ??= err;
  };
  try {
    if (verifying) {
      await verifyGrantedPurchases(app, [row], {
        shop: store?.shopDomain,
        fetchSales: deps.fetchSales,
        onRowError,
      });
    } else {
      await checkPurchases(app, [row], {
        shop: store?.shopDomain,
        fetchSales: deps.fetchSales,
        onRowError,
        onSettled: async (tx, settled) => {
          await recordAudit(tx, {
            actor,
            action: 'shopify_purchase.settle',
            resourceType: 'shopify_credit_purchases',
            resourceId: settled.id,
            after: { credits: settled.credits, chargeId: settled.shopifyChargeId },
            request,
          });
        },
      });
    }
  } catch (err) {
    if (err instanceof PartnerApiError) {
      throw new AppError('SHOPIFY', 502, `Partner API unavailable: ${err.reason}`);
    }
    throw err;
  }
  if (rowError) throw rowError;

  // Report the database, not the checker's outcome: a concurrent settle can win.
  const fresh = await load();
  return { paymentStatus: fresh?.paymentStatus ?? row.paymentStatus };
}

/**
 * An admin's decision about whether a purchase was paid. Sets the status by hand
 * (source MANUAL, which the automatic loop then leaves alone), records a note and
 * who/when, and audits it in the same transaction. NEVER touches the ledger or any
 * balance: this feature records decisions, it does not move credits. Held rows are
 * refused because they have their own settle flow and their credits are not granted.
 */
export async function adminReviewPurchasePayment(
  app: FastifyInstance,
  purchaseId: string,
  body: ReviewBodyInput,
  actor: { userId: string; role: string },
  request: FastifyRequest,
) {
  return app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(P).where(eq(P.id, purchaseId)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', 404, 'purchase not found');
    if (!(GRANTED_STATUSES as readonly string[]).includes(row.paymentStatus)) {
      throw new AppError('CONFLICT', 409, 'held purchase — use Check payment, not a manual review');
    }

    const now = new Date();
    const set: Partial<typeof P.$inferInsert> = {
      paymentNote: body.note,
      paymentFlaggedBy: actor.userId,
      paymentFlaggedAt: now,
      updatedAt: now,
    };
    if (body.status === 'PAID' || body.status === 'NOT_RECEIVED') {
      Object.assign(set, {
        paymentStatus: body.status,
        paymentStatusSource: 'MANUAL',
        nextPaymentCheckAt: null,
        paidAt: body.status === 'PAID' ? (row.paidAt ?? now) : null,
      });
    } else if (body.status === 'AUTO') {
      if (row.paymentStatusSource !== 'MANUAL') {
        throw new AppError('CONFLICT', 409, 'there is no manual override to clear');
      }
      Object.assign(set, {
        paymentStatus: 'UNVERIFIED',
        paymentStatusSource: 'AUTO',
        nextPaymentCheckAt: now,
        paidAt: null,
      });
    }

    // Conditional on still being a granted row: a concurrent change to a held
    // state must not be overwritten by a stale read.
    const updated = await tx
      .update(P)
      .set(set)
      .where(and(eq(P.id, row.id), inArray(P.paymentStatus, [...GRANTED_STATUSES])))
      .returning({
        paymentStatus: P.paymentStatus,
        paymentStatusSource: P.paymentStatusSource,
        paymentNote: P.paymentNote,
        paymentFlaggedAt: P.paymentFlaggedAt,
      });
    if (updated.length === 0)
      throw new AppError('CONFLICT', 409, 'purchase changed — reload and retry');

    await recordAudit(tx, {
      actor,
      action: 'shopify_purchase.payment_review',
      resourceType: 'shopify_credit_purchases',
      resourceId: row.id,
      before: {
        paymentStatus: row.paymentStatus,
        paymentStatusSource: row.paymentStatusSource,
        paymentNote: row.paymentNote,
      },
      after: {
        paymentStatus: updated[0].paymentStatus,
        paymentStatusSource: updated[0].paymentStatusSource,
        paymentNote: updated[0].paymentNote,
      },
      request,
    });
    return updated[0];
  });
}

export async function adminShopifyPurchasesRoutes(app: FastifyInstance) {
  const RO = requirePermission('shopify_stores.read');
  // credits.write, not a shopify_stores capability: shopify_stores only has
  // read/delete, and these actions are about credit purchases.
  const RW = requirePermission('credits.write');

  app.get(
    '/admin/shopify/purchases',
    { preHandler: RO, schema: { querystring: ListQuery } },
    async (req) => {
      const q = req.query as z.infer<typeof ListQuery>;
      const statuses = q.paymentStatus
        ? q.paymentStatus
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const bad = statuses.find((s) => !(PAYMENT_STATUSES as readonly string[]).includes(s));
      if (bad) throw new AppError('BAD_REQUEST', 400, `unknown paymentStatus "${bad}"`);

      const windowAgo = new Date(Date.now() - verifyWindowMs(app.env));
      const conds = [eq(P.source, 'manual'), eq(P.status, 'ACTIVE')];
      if (statuses.length) conds.push(inArray(P.paymentStatus, statuses));
      if (q.storeId) conds.push(eq(P.storeId, q.storeId));
      if (q.q)
        conds.push(ilike(schema.shopifyStores.shopDomain, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`));
      if (q.from) conds.push(gte(P.createdAt, new Date(q.from)));
      if (q.to) conds.push(lte(P.createdAt, new Date(q.to)));
      if (q.needsAttention === 'true') {
        const attention = or(
          eq(P.paymentStatus, 'NOT_RECEIVED'),
          and(eq(P.paymentStatus, 'UNVERIFIED'), lt(P.createdAt, windowAgo)),
          isNotNull(P.paymentNote),
        );
        if (attention) conds.push(attention);
      }
      if (q.cursor) conds.push(lt(P.createdAt, new Date(q.cursor)));

      const rows = await app.db
        .select({
          id: P.id,
          storeId: P.storeId,
          shopDomain: schema.shopifyStores.shopDomain,
          packId: P.packId,
          credits: P.credits,
          priceUsdCents: P.priceUsdCents,
          status: P.status,
          paymentStatus: P.paymentStatus,
          paymentStatusSource: P.paymentStatusSource,
          paidAt: P.paidAt,
          paymentNote: P.paymentNote,
          paymentFlaggedAt: P.paymentFlaggedAt,
          flaggedByName: schema.users.displayName,
          flaggedByEmail: schema.users.email,
          createdAt: P.createdAt,
          shopifyChargeId: P.shopifyChargeId,
          // When the credits were actually written to the ledger, if they were.
          creditsGrantedAt: sql<Date | null>`(
          select min(l.created_at) from shopify_credit_ledger l
          where l.external_ref = 'shopify_pack:' || ${P.shopifyChargeId}
        )`,
        })
        .from(P)
        .innerJoin(schema.shopifyStores, eq(schema.shopifyStores.id, P.storeId))
        .leftJoin(schema.users, eq(schema.users.id, P.paymentFlaggedBy))
        .where(and(...conds))
        .orderBy(desc(P.createdAt))
        .limit(q.limit);

      const nextCursor =
        rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null;
      return { purchases: rows, nextCursor };
    },
  );

  app.post(
    '/admin/shopify/purchases/:id/payment-review',
    { preHandler: RW, schema: { params: z.object({ id: z.string().uuid() }), body: ReviewBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      return adminReviewPurchasePayment(
        app,
        id,
        req.body as ReviewBodyInput,
        { userId: req.userId, role: req.adminRole as string },
        req,
      );
    },
  );

  app.post(
    '/admin/shopify/purchases/:id/check-payment',
    { preHandler: RW, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      return adminCheckPurchasePayment(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
      );
    },
  );
}
