import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { signAccess } from '../auth/service.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Every Shopify store gets exactly one synthetic platform user, created on
 * first use, that exists purely to own that store's support tickets in the
 * chatbot ticket system. Distinct from `owner_user_id` (the real merchant
 * account, when one exists) — this row is never a real login and holds no
 * credits, uploads, or catalog data of its own.
 */
async function getOrCreateSupportUser(app: FastifyInstance, store: Store): Promise<string> {
  if (store.supportUserId) return store.supportUserId;

  // The shop domain, not the store's opaque id, so an agent recognizes the
  // merchant at a glance from ChatInboxPage's existing userEmail column —
  // this is the only signal that distinguishes a Shopify-admin ticket, since
  // the shared WS gateway (apps/chatbot/src/ws/gateway.ts) always creates
  // tickets with source: 'chat_widget' regardless of caller and cannot be
  // told otherwise without changing apps/chatbot. It also has to be
  // deterministic (not random) so the orphan-adoption lookup below can find
  // it again.
  const email = `shopify-support+${store.shopDomain}@internal.aivastra.com`;

  return app.db.transaction(async (tx) => {
    // Lock the store row: a concurrent first-open (two tabs) racing this
    // function is not "harmless" — users.email is UNIQUE, so the loser's
    // INSERT below would hit the constraint and throw (Postgres 23505),
    // surfacing as an unhandled 500 to the merchant. Locking the row here
    // serializes the two transactions so the second one's re-check sees the
    // first one's committed supportUserId instead of racing the insert.
    const [existing] = await tx
      .select({ supportUserId: schema.shopifyStores.supportUserId })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id))
      .for('update');
    if (existing?.supportUserId) return existing.supportUserId;

    // A row with this exact email can already exist as an orphan: the admin
    // hard-delete-store route (admin/shopify-stores.routes.ts) removes the
    // shopify_stores row but has no cascade onto the synthetic user it
    // created (supportUserId is ON DELETE SET NULL on the store side only,
    // never a store->user cascade), so a reinstalled store comes back with
    // supportUserId NULL while `users` still holds this deterministic email.
    // Adopt that row instead of inserting a duplicate — otherwise the insert
    // below throws on users.email's UNIQUE constraint every time, forever,
    // for that store.
    const [orphan] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    let userId: string;
    if (orphan) {
      userId = orphan.id;
    } else {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email,
          passwordHash: null,
          displayName: `Shopify support (${store.shopDomain})`,
          companyName: null,
          emailVerified: true,
          tier: 'free',
        })
        .returning();
      userId = user.id;
      await tx.insert(schema.userCredits).values({
        userId: user.id,
        balance: 0,
        // A synthetic user with no real mailbox must never enter the
        // low-credit-alert email loop: startUserLowCreditAlertScheduler
        // selects on `lowCreditAlertSentAt IS NULL` + balance below
        // threshold, and this address (shopify-support+<domain>@internal...)
        // bounces every time, which is a sender-reputation risk shared with
        // real transactional email. Pre-stamping this suppresses it for good.
        lowCreditAlertSentAt: new Date(),
      });
    }

    await tx
      .update(schema.shopifyStores)
      .set({ supportUserId: userId })
      .where(eq(schema.shopifyStores.id, store.id));
    return userId;
  });
}

export async function shopifySupportRoutes(app: FastifyInstance) {
  app.post(
    '/v1/shopify/support/session',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as Store;
      const supportUserId = await getOrCreateSupportUser(app, store);
      const secret = new TextEncoder().encode(app.env.JWT_SECRET);
      const token = await signAccess(secret, supportUserId, { kind: 'access' }, app.env.JWT_EXPIRY);
      return { token };
    },
  );
}
