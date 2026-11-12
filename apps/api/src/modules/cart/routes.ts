import { randomInt } from 'node:crypto';
import { type DbTransaction, schema } from '@aivastra/db';
import { CartBillBody, CartLineAddBody, type CartView } from '@aivastra/types';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { recordAudit } from '../admin/audit.js';
import { recordEvent } from '../analytics/record.js';

// CRM phase 3, slice 3b (spec §6.1, plan P1–P3, P6). Rules live here, never in the tablet.
// A cart line is NOT a sale; billing confirms it with a source and a price, and also writes the
// existing session_items 'sold' rows + sale_recorded events (P2), so every dashboard, the staff
// leaderboard and the analytics parity test keep counting one kind of "sold".

const C = schema.carts;
const L = schema.cartLines;
// Same unambiguous alphabet as the identify and CONNECT codes: typed at the counter.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const ABANDON_AFTER_HOURS = 24;

const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
    '',
  );

export async function cartView(db: FastifyInstance['db'], cartId: string): Promise<CartView> {
  const [cart] = await db.select().from(C).where(eq(C.id, cartId)).limit(1);
  if (!cart) throw new AppError('NOT_FOUND', 404, 'cart not found');
  const rows = await db
    .select({
      line: L,
      size: schema.merchantCatalogVariants.size,
      colour: schema.merchantCatalogVariants.colour,
      sku: schema.merchantCatalogVariants.sku,
      barcode: schema.merchantCatalogVariants.barcode,
      priceOverride: schema.merchantCatalogVariants.priceOverridePaise,
      label: schema.merchantCatalogItems.label,
      offerPrice: schema.merchantCatalogItems.offerPricePaise,
    })
    .from(L)
    .innerJoin(schema.merchantCatalogVariants, eq(schema.merchantCatalogVariants.id, L.variantId))
    .innerJoin(schema.merchantCatalogItems, eq(schema.merchantCatalogItems.id, L.catalogItemId))
    .where(and(eq(L.cartId, cartId), isNull(L.removedAt)))
    .orderBy(asc(L.createdAt));
  const lines = rows.map((r) => {
    const unit = r.line.billedPricePaise ?? r.priceOverride ?? r.offerPrice;
    return {
      id: r.line.id,
      variantId: r.line.variantId,
      catalogItemId: r.line.catalogItemId,
      label: r.label,
      size: r.size,
      colour: r.colour,
      sku: r.sku,
      barcode: r.barcode,
      quantity: r.line.quantity,
      unitPricePaise: unit,
      addedBy: r.line.addedBy,
      billed: r.line.billedAt !== null,
    };
  });
  return {
    cartCode: cart.cartCode,
    status: cart.status,
    branchId: cart.branchId,
    lines,
    totalPaise: lines.reduce((a, l) => a + l.unitPricePaise * l.quantity, 0),
  };
}

/**
 * Confirms lines as billed (P2, P3). Per unit: one session_items 'sold' row attributed to the
 * billing staff member (the seller) and one sale_recorded event. Idempotent per line: a line
 * already billed is skipped, so a retried bill never double-counts.
 */
export async function billLines(
  tx: DbTransaction,
  cart: typeof C.$inferSelect,
  lineIds: string[] | undefined,
  /** The seller; null when the merchant admin (not a staff member) bills. */
  staffId: string | null,
  source: string,
): Promise<number> {
  const [session] = await tx
    .select()
    .from(schema.instoreSessions)
    .where(eq(schema.instoreSessions.id, cart.sessionId));
  const open = await tx
    .select({
      line: L,
      priceOverride: schema.merchantCatalogVariants.priceOverridePaise,
      offerPrice: schema.merchantCatalogItems.offerPricePaise,
    })
    .from(L)
    .innerJoin(schema.merchantCatalogVariants, eq(schema.merchantCatalogVariants.id, L.variantId))
    .innerJoin(schema.merchantCatalogItems, eq(schema.merchantCatalogItems.id, L.catalogItemId))
    .where(
      and(
        eq(L.cartId, cart.id),
        isNull(L.removedAt),
        isNull(L.billedAt),
        lineIds ? inArray(L.id, lineIds) : undefined,
      ),
    )
    .for('update', { of: L });
  for (const { line, priceOverride, offerPrice } of open) {
    const price = priceOverride ?? offerPrice;
    const items = await tx
      .insert(schema.sessionItems)
      .values(
        Array.from({ length: line.quantity }, () => ({
          sessionId: cart.sessionId,
          catalogItemId: line.catalogItemId,
          action: 'sold' as const,
          staffId,
        })),
      )
      .returning({ id: schema.sessionItems.id });
    for (const it of items) {
      await recordEvent(tx, {
        event: 'sale_recorded',
        merchantId: cart.merchantId,
        branchId: session!.branchId,
        deviceId: session!.deviceId,
        staffId,
        sessionId: cart.sessionId,
        shopperId: session!.shopperId,
        catalogItemId: line.catalogItemId,
        channel: session!.mode,
        props: {
          cartLineId: line.id,
          variantId: line.variantId,
          source,
          pricePaise: price,
          sessionItemId: it.id,
        },
      });
    }
    await tx
      .update(L)
      .set({
        billedAt: new Date(),
        billedSource: source,
        billedPricePaise: price,
        billedByStaffId: staffId,
        sessionItemIds: items.map((i) => i.id),
      })
      .where(eq(L.id, line.id));
  }
  // Closed once nothing is left to bill.
  const [left] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(L)
    .where(and(eq(L.cartId, cart.id), isNull(L.removedAt), isNull(L.billedAt)));
  if ((left?.n ?? 0) === 0 && open.length > 0) {
    await tx
      .update(C)
      .set({ status: 'billed', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(C.id, cart.id));
  }
  return open.length;
}

export async function cartRoutes(app: FastifyInstance) {
  const sessionParams = z.object({ id: z.string().uuid() });

  const ownSession = async (deviceId: string, sessionId: string) => {
    const [s] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(
        and(
          eq(schema.instoreSessions.id, sessionId),
          eq(schema.instoreSessions.deviceId, deviceId),
        ),
      )
      .limit(1);
    if (!s) throw new AppError('NOT_FOUND', 404, 'session not found');
    return s;
  };

  app.get(
    '/v1/device/sessions/:id/cart',
    { preHandler: app.requireDevice, schema: { params: sessionParams } },
    async (req) => {
      const s = await ownSession(req.device!.deviceId, (req.params as { id: string }).id);
      const [cart] = await app.db.select().from(C).where(eq(C.sessionId, s.id)).limit(1);
      return { cart: cart ? await cartView(app.db, cart.id) : null };
    },
  );

  app.post(
    '/v1/device/sessions/:id/cart/lines',
    { preHandler: app.requireDevice, schema: { params: sessionParams, body: CartLineAddBody } },
    async (req, reply) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const body = req.body as CartLineAddBody;
      const result = await withIdempotency(
        app,
        'device-cart-lines',
        d.deviceId,
        req.headers['idempotency-key'] as string | undefined,
        async () => {
          const s = await ownSession(d.deviceId, id);
          if (s.endedAt) throw new AppError('SESSION_ENDED', 409, 'session already ended');
          const [variant] = await app.db
            .select()
            .from(schema.merchantCatalogVariants)
            .where(
              and(
                eq(schema.merchantCatalogVariants.id, body.variantId),
                eq(schema.merchantCatalogVariants.merchantId, d.merchantId),
                eq(schema.merchantCatalogVariants.isActive, true),
              ),
            )
            .limit(1);
          if (!variant) throw new AppError('NOT_FOUND', 404, 'variant not found');
          // Spec §6.2: an out-of-stock size cannot be added at this branch (it can still be
          // tried, and the tablet points to other branches / buy online).
          const [stock] = await app.db
            .select({ status: schema.variantBranchStock.status })
            .from(schema.variantBranchStock)
            .where(
              and(
                eq(schema.variantBranchStock.variantId, variant.id),
                eq(schema.variantBranchStock.branchId, s.branchId),
              ),
            )
            .limit(1);
          if (stock?.status === 'out') {
            throw new AppError('OUT_OF_STOCK', 409, 'this size is out of stock at this branch');
          }

          await app.db.transaction(async (tx) => {
            let [cart] = await tx.select().from(C).where(eq(C.sessionId, s.id)).for('update');
            if (!cart) {
              for (let i = 0; i < 5 && !cart; i++) {
                [cart] = await tx
                  .insert(C)
                  .values({
                    merchantId: d.merchantId,
                    branchId: s.branchId,
                    sessionId: s.id,
                    cartCode: newCode(),
                  })
                  .onConflictDoNothing()
                  .returning();
              }
              if (!cart) throw new AppError('CART_UNAVAILABLE', 503, 'could not open a cart');
            }
            if (cart.status !== 'open') throw new AppError('CART_CLOSED', 409, 'cart is closed');
            // The same size again raises the quantity of the open line.
            const [same] = await tx
              .select()
              .from(L)
              .where(
                and(
                  eq(L.cartId, cart.id),
                  eq(L.variantId, variant.id),
                  isNull(L.removedAt),
                  isNull(L.billedAt),
                ),
              )
              .for('update');
            if (same) {
              await tx
                .update(L)
                .set({ quantity: Math.min(20, same.quantity + body.quantity) })
                .where(eq(L.id, same.id));
            } else {
              await tx.insert(L).values({
                cartId: cart.id,
                merchantId: d.merchantId,
                variantId: variant.id,
                catalogItemId: variant.catalogItemId,
                quantity: body.quantity,
                addedBy: s.mode === 'assisted' ? 'staff' : 'shopper',
                addedByStaffId: s.mode === 'assisted' ? s.staffId : null,
              });
            }
            await recordEvent(tx, {
              event: 'cart_added',
              merchantId: d.merchantId,
              branchId: s.branchId,
              deviceId: d.deviceId,
              staffId: s.staffId,
              sessionId: s.id,
              shopperId: s.shopperId,
              catalogItemId: variant.catalogItemId,
              channel: s.mode,
              props: { variantId: variant.id, quantity: body.quantity },
            });
          });
          const [cart] = await app.db.select().from(C).where(eq(C.sessionId, s.id)).limit(1);
          return cartView(app.db, cart!.id);
        },
      );
      return reply.code(201).send(result);
    },
  );

  app.delete(
    '/v1/device/sessions/:id/cart/lines/:lineId',
    {
      preHandler: app.requireDevice,
      schema: { params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }) },
    },
    async (req) => {
      const d = req.device!;
      const { id, lineId } = req.params as { id: string; lineId: string };
      const s = await ownSession(d.deviceId, id);
      const [cart] = await app.db.select().from(C).where(eq(C.sessionId, s.id)).limit(1);
      if (!cart) throw new AppError('NOT_FOUND', 404, 'cart not found');
      await app.db.transaction(async (tx) => {
        const [line] = await tx
          .update(L)
          .set({ removedAt: new Date() })
          .where(
            and(eq(L.id, lineId), eq(L.cartId, cart.id), isNull(L.removedAt), isNull(L.billedAt)),
          )
          .returning();
        // Already removed, billed or not this cart's: nothing to undo, nothing to record.
        if (!line) return;
        await recordEvent(tx, {
          event: 'cart_removed',
          merchantId: d.merchantId,
          branchId: s.branchId,
          deviceId: d.deviceId,
          staffId: s.staffId,
          sessionId: s.id,
          shopperId: s.shopperId,
          catalogItemId: line.catalogItemId,
          channel: s.mode,
          props: { variantId: line.variantId, quantity: line.quantity },
        });
      });
      return cartView(app.db, cart.id);
    },
  );

  // Assisted session: the staff member bills on the tablet with their own sign-in.
  app.post(
    '/v1/device/sessions/:id/cart/bill',
    { preHandler: app.requireDevice, schema: { params: sessionParams, body: CartBillBody } },
    async (req) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const { lineIds } = (req.body ?? {}) as CartBillBody;
      const s = await ownSession(d.deviceId, id);
      const member = await app.resolveStaffFromRequest(req);
      if (
        member.role !== 'staff' ||
        member.merchantId !== d.merchantId ||
        member.branchId !== s.branchId
      ) {
        throw new AppError('FORBIDDEN', 403, "staff of this cart's branch required");
      }
      const [cart] = await app.db.select().from(C).where(eq(C.sessionId, s.id)).limit(1);
      if (!cart) throw new AppError('NOT_FOUND', 404, 'cart not found');
      return bill(app, req, cart, lineIds, member.staffId!, member.userId, 'MERCHANT_STAFF');
    },
  );

  // Kiosk carts are billed at the counter by code, in Merchant Web (plan P6). Staff only for
  // their own branch; the merchant admin any branch. A foreign or unknown code is one 404.
  const findByCode = async (merchantId: string, code: string) => {
    const [cart] = await app.db
      .select()
      .from(C)
      .where(and(eq(C.cartCode, code.trim().toUpperCase()), eq(C.merchantId, merchantId)))
      .limit(1);
    if (!cart) throw new AppError('NOT_FOUND', 404, 'cart not found');
    return cart;
  };
  const codeParams = z.object({ code: z.string().trim().min(4).max(16) });

  app.get(
    '/v1/merchant/carts/:code',
    { preHandler: app.requireMerchantMember, schema: { params: codeParams } },
    async (req) => {
      const m = req.merchantMember!;
      const cart = await findByCode(m.merchantId, (req.params as { code: string }).code);
      if (m.role !== 'admin' && m.branchId !== cart.branchId) {
        throw new AppError('NOT_FOUND', 404, 'cart not found');
      }
      return cartView(app.db, cart.id);
    },
  );

  app.post(
    '/v1/merchant/carts/:code/bill',
    { preHandler: app.requireMerchantMember, schema: { params: codeParams, body: CartBillBody } },
    async (req) => {
      const m = req.merchantMember!;
      const { lineIds } = (req.body ?? {}) as CartBillBody;
      const cart = await findByCode(m.merchantId, (req.params as { code: string }).code);
      if (m.role !== 'admin' && m.branchId !== cart.branchId) {
        throw new AppError('NOT_FOUND', 404, 'cart not found');
      }
      // The admin bills under a staff identity only if they are staff; otherwise the sale is
      // attributed to nobody, like a kiosk sale.
      return bill(
        app,
        req,
        cart,
        lineIds,
        m.staffId ?? null,
        m.userId,
        m.role === 'admin' ? 'MERCHANT_ADMIN' : 'MERCHANT_STAFF',
      );
    },
  );
}

async function bill(
  app: FastifyInstance,
  req: Parameters<typeof recordAudit>[1]['request'],
  cart: typeof C.$inferSelect,
  lineIds: string[] | undefined,
  staffId: string | null,
  userId: string,
  role: string,
): Promise<CartView> {
  if (cart.status === 'abandoned') {
    throw new AppError('CART_CLOSED', 409, 'this cart has expired');
  }
  await app.db.transaction(async (tx) => {
    const n = await billLines(tx, cart, lineIds, staffId, 'staff');
    if (n > 0) {
      await recordAudit(tx, {
        actor: { userId, role },
        action: 'cart.bill',
        resourceType: 'cart',
        resourceId: cart.id,
        after: { cartCode: cart.cartCode, lines: n },
        request: req,
      });
    }
  });
  return cartView(app.db, cart.id);
}

/** Hourly: open carts older than a day are abandoned (spec §6.1: they count as abandoned). */
export async function runCartAbandonTick(app: FastifyInstance): Promise<number> {
  const rows = await app.db
    .update(C)
    .set({ status: 'abandoned', closedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(C.status, 'open'),
        sql`${C.createdAt} < now() - make_interval(hours => ${ABANDON_AFTER_HOURS})`,
      ),
    )
    .returning({ id: C.id });
  return rows.length;
}

export function startCartAbandonSweeper(app: FastifyInstance): () => void {
  const timer = setInterval(
    () => {
      void runCartAbandonTick(app).catch((err) =>
        app.log.error({ err }, 'cart abandon tick failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
  return () => clearInterval(timer);
}
