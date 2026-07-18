import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { shopifyAdminFetch } from './service.js';

export async function shopifyOnboardingRoutes(app: FastifyInstance) {
  app.post(
    '/v1/shopify/onboarding/confirm-theme-block',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const settings = { ...store.settings, themeBlockConfirmed: true };

      await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      return { settings };
    },
  );

  // Deep-links straight into the merchant's live theme editor with the app-blocks
  // panel already open (?context=apps) — the theme editor has no stable/predictable
  // URL without the current main theme's ID, so this has to ask Shopify each time
  // rather than being buildable client-side from just the shop domain.
  app.get(
    '/v1/shopify/onboarding/theme-editor-url',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { decryptToken } = await import('../../lib/crypto.js');
      const token = decryptToken(store.accessToken, app.env.SHOPIFY_TOKEN_ENC_KEY ?? '');

      const res = await shopifyAdminFetch(store.shopDomain, token, '/themes.json?role=main');
      if (!res.ok) throw new AppError('SHOPIFY', 502, 'theme lookup failed');
      const { themes } = (await res.json()) as { themes: Array<{ id: number }> };
      const mainTheme = themes[0];
      if (!mainTheme) throw new AppError('SHOPIFY', 502, 'no main theme found');

      return {
        url: `https://${store.shopDomain}/admin/themes/${mainTheme.id}/editor?context=apps`,
      };
    },
  );
}
