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

  return app.db.transaction(async (tx) => {
    // Re-check inside the transaction: a concurrent first-open (two tabs) can
    // race this function. A duplicate synthetic user in that rare case is
    // harmless and cleanup-able — not worth a locking scheme.
    const [existing] = await tx
      .select({ supportUserId: schema.shopifyStores.supportUserId })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    if (existing?.supportUserId) return existing.supportUserId;

    const [user] = await tx
      .insert(schema.users)
      .values({
        // The shop domain, not the store's opaque id, so an agent recognizes
        // the merchant at a glance from ChatInboxPage's existing userEmail
        // column — this is the only signal that distinguishes a
        // Shopify-admin ticket, since the shared WS gateway
        // (apps/chatbot/src/ws/gateway.ts) always creates tickets with
        // source: 'chat_widget' regardless of caller and cannot be told
        // otherwise without changing apps/chatbot.
        email: `shopify-support+${store.shopDomain}@internal.aivastra.com`,
        passwordHash: null,
        displayName: `Shopify support (${store.shopDomain})`,
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await tx.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    await tx
      .update(schema.shopifyStores)
      .set({ supportUserId: user.id })
      .where(eq(schema.shopifyStores.id, store.id));
    return user.id;
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
