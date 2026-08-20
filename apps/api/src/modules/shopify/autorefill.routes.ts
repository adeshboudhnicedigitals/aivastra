import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  confirmAutorefill,
  defaultTriggerCredits,
  disableAutorefill,
  enrolAutorefill,
  raiseCap,
} from './autorefill.js';

const EnrolBody = z.object({
  packId: z.string().min(1).max(64),
  triggerCredits: z.number().int().positive().max(1_000_000).optional(),
  cappedAmountUsd: z.number().positive().max(10_000),
});

const UpdateBody = z.object({
  packId: z.string().min(1).max(64).optional(),
  triggerCredits: z.number().int().positive().max(1_000_000).optional(),
});

const RaiseCapBody = z.object({ cappedAmountUsd: z.number().positive().max(10_000) });

export async function shopifyAutorefillRoutes(app: FastifyInstance) {
  const store = (req: { shopifyStore?: unknown }) =>
    req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

  app.post(
    '/v1/shopify/billing/autorefill',
    { preHandler: app.requireShopifySession, schema: { body: EnrolBody } },
    async (req) => enrolAutorefill(app, store(req), req.body as z.infer<typeof EnrolBody>),
  );

  app.get(
    '/v1/shopify/billing/autorefill/confirm',
    { preHandler: app.requireShopifySession },
    async (req) => confirmAutorefill(app, store(req)),
  );

  // Changing pack or threshold does not touch the approved ceiling, so it needs
  // no new merchant approval — the authorization the merchant gave is a dollar
  // ceiling, and neither of these raises it.
  app.patch(
    '/v1/shopify/billing/autorefill',
    { preHandler: app.requireShopifySession, schema: { body: UpdateBody } },
    async (req) => {
      const s = store(req);
      const body = req.body as z.infer<typeof UpdateBody>;
      const packId = body.packId ?? s.autorefillPackId;
      const patch: Partial<typeof schema.shopifyStores.$inferInsert> = { updatedAt: new Date() };
      if (body.packId) patch.autorefillPackId = body.packId;
      if (body.triggerCredits != null) {
        patch.autorefillTriggerCredits = body.triggerCredits;
      } else if (body.packId && packId) {
        patch.autorefillTriggerCredits = defaultTriggerCredits(packId);
      }
      await app.db.update(schema.shopifyStores).set(patch).where(eq(schema.shopifyStores.id, s.id));
      return { ok: true };
    },
  );

  app.delete(
    '/v1/shopify/billing/autorefill',
    { preHandler: app.requireShopifySession },
    async (req) => {
      await disableAutorefill(app, store(req));
      return { ok: true };
    },
  );

  app.post(
    '/v1/shopify/billing/autorefill/raise-cap',
    { preHandler: app.requireShopifySession, schema: { body: RaiseCapBody } },
    async (req) =>
      raiseCap(app, store(req), (req.body as z.infer<typeof RaiseCapBody>).cappedAmountUsd),
  );
}
