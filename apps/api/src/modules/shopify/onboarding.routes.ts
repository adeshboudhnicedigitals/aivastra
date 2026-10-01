import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { grantShopifyEmailBonus, storeBalance } from './purchase.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';

// Onboarding's contact step. Name and email are required; phone is optional and
// a blank one is stored as null so "no phone" has one shape. Digits and the usual
// separators only — this is a number to ring in an emergency, not free text.
const SaveContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()\-.\s]*$/, 'phone number may only contain digits and + ( ) - .')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

/**
 * Handle of the app embed, i.e. the filename of
 * `apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button.liquid`
 * minus its extension. Renaming that file silently breaks this deep link —
 * Shopify just opens the editor without switching the embed on.
 */
const TRYON_BLOCK_HANDLE = 'tryon-button';

/**
 * Pure parse: does the live theme's `config/settings_data.json` (verbatim
 * Admin API content) contain our app embed block, switched on?
 *
 * Shopify sometimes prefixes this file with a `/* ... *\/` comment block
 * that would otherwise break JSON.parse — stripped first. Block `type`
 * strings look like `shopify://apps/{api_key}/blocks/{handle}/{extension_uid}`;
 * matched on the handle prefix only, since the trailing UID belongs to this
 * extension's own installed-block identity and isn't worth hard-coding here.
 * A block with no `disabled` key is enabled by Shopify's own convention —
 * only an explicit `disabled: true` turns it off.
 */
export function findThemeEmbedEnabled(content: string, apiKey: string): boolean {
  try {
    const stripped = content.replace(/\/\*[\s\S]*?\*\//, '');
    const parsed = JSON.parse(stripped);
    const blocks = parsed?.current?.blocks ?? {};
    const prefix = `shopify://apps/${apiKey}/blocks/${TRYON_BLOCK_HANDLE}/`;
    return Object.values(blocks).some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        typeof block.type === 'string' &&
        block.type.startsWith(prefix) &&
        block.disabled !== true,
    );
  } catch {
    return false;
  }
}

/**
 * Deep link into the merchant's live theme editor, opened on the App embeds
 * panel with our embed switched on (the merchant still has to press Save).
 *
 * Deliberately builds a URL instead of asking the Admin API for the theme ID.
 * The obvious implementation — GET /themes.json?role=main — needs the
 * `read_themes` scope, which this app does not request (see `scopes` in
 * apps/shopify-extension/shopify.app.toml). Shopify answers that call with a
 * 403, `shopifyAdminFetch` turns every 403 into SHOPIFY_REAUTH_REQUIRED, and
 * the SPA then bounces the merchant through OAuth — which re-grants the same
 * scope set and 403s again on the next click. An unbreakable loop on the one
 * button new merchants are told to press first.
 *
 * `themes/current` resolves the published theme server-side, so no theme ID is
 * needed. `activateAppId` is `{client_id}/{embed handle}` and `context=apps`
 * opens the App embeds panel; `template=product` makes the preview a product
 * page, which is the only page the embed draws on. History: this was an
 * `addAppBlockId` app-block link from 2026-07-31 until the embed came back;
 * blocks are placed by the merchant, embeds are injected globally by Shopify,
 * and the two use different parameters.
 */
export function buildThemeEditorDeepLink(shopDomain: string, apiKey: string): string {
  return (
    `https://${shopDomain}/admin/themes/current/editor` +
    `?context=apps&template=product&activateAppId=${apiKey}/${TRYON_BLOCK_HANDLE}`
  );
}

/**
 * Records that the try-on app embed is live on the storefront. Called from the
 * widget's first request on a product page (see the /enabled route in
 * customer.routes.ts), so the merchant never has to say "I've enabled it".
 *
 * Sets both flags: `themeBlockConfirmed` is what the onboarding gate reads, and
 * `themeEmbedConfirmed` is what clears the Dashboard prompt for stores that
 * finished onboarding while the button was still an app block.
 *
 * Cheap on purpose — this rides on a per-page-view request, so once the flag is
 * set it returns without touching the database.
 */
export async function markThemeEmbedSeen(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<void> {
  if (store.settings?.themeEmbedConfirmed) return;
  await app.db
    .update(schema.shopifyStores)
    .set({
      settings: mergeStoreSettingsObject(storeSettingsJson(), [], {
        themeBlockConfirmed: true,
        themeEmbedConfirmed: true,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, store.id));
}

/**
 * Grants the free-credits welcome bonus and marks it granted. The Dashboard calls
 * this on arrival, so the merchant never has to claim anything: the store's
 * contact email came from Shopify at install (and onboarding's contact step lets
 * them correct it), so there is nothing left to ask.
 *
 * The settings flag only stops us doing the work twice; `grantShopifyEmailBonus`'s
 * own external_ref is the real idempotency guard against two Dashboard loads
 * racing the check below. The amount is the admin-configured
 * `shopify.trialCredits` (default 25), never a number hard-coded here.
 */
async function grantWelcomeCredits(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<{ creditsGranted: number; creditBalance: number; settings: unknown }> {
  if (store.settings.emailBonusClaimed) {
    return {
      creditsGranted: 0,
      creditBalance: await storeBalance(app, store.id),
      settings: store.settings,
    };
  }

  const settings = mergeStoreSettingsObject(storeSettingsJson(), [], {
    emailBonusClaimed: true,
    emailBonusClaimedAt: new Date().toISOString(),
  });

  const [updated] = await app.db
    .update(schema.shopifyStores)
    .set({ settings, updatedAt: new Date() })
    .where(eq(schema.shopifyStores.id, store.id))
    .returning({ settings: schema.shopifyStores.settings });
  if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

  const { creditsGranted } = await grantShopifyEmailBonus(app, store);
  return {
    creditsGranted,
    creditBalance: await storeBalance(app, store.id),
    settings: updated.settings,
  };
}

export async function shopifyOnboardingRoutes(app: FastifyInstance) {
  // Writes the columns the install already fills from Shopify (shop_owner_name,
  // shop_email, shop_phone), so the admin panel, the low-credit alert emails and
  // the GDPR redaction all keep working from the one place. A reinstall re-reads
  // Shopify's values over these; the merchant's own entry survives until then.
  app.post(
    '/v1/shopify/onboarding/contact',
    { preHandler: app.requireShopifySession, schema: { body: SaveContactBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { name, email, phone } = req.body as z.infer<typeof SaveContactBody>;

      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({
          shopOwnerName: name,
          shopEmail: email,
          shopPhone: phone ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.shopifyStores.id, store.id))
        .returning({
          shopOwnerName: schema.shopifyStores.shopOwnerName,
          shopEmail: schema.shopifyStores.shopEmail,
          shopPhone: schema.shopifyStores.shopPhone,
        });
      if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

      return updated;
    },
  );

  app.post(
    '/v1/shopify/onboarding/confirm-routing',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const settings = mergeStoreSettingsObject(storeSettingsJson(), [], {
        onboardingRoutingConfirmed: true,
      });

      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id))
        .returning({ settings: schema.shopifyStores.settings });
      if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

      return { settings: updated.settings };
    },
  );

  app.post(
    '/v1/shopify/onboarding/complete',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const settings = mergeStoreSettingsObject(storeSettingsJson(), [], {
        onboardingCompletedOnce: true,
      });

      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id))
        .returning({ settings: schema.shopifyStores.settings });
      if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

      return { settings: updated.settings };
    },
  );

  // Called by the Dashboard on arrival. Idempotent, so a reload or a second tab
  // is harmless; creditsGranted is 0 whenever the bonus was already given.
  app.post(
    '/v1/shopify/onboarding/welcome-credits',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      return grantWelcomeCredits(app, store);
    },
  );

  // Pure string build — no Shopify API call, no token decrypt. See
  // buildThemeEditorDeepLink for why asking the Admin API here is a trap.
  app.get(
    '/v1/shopify/onboarding/theme-editor-url',
    { preHandler: app.requireShopifySession },
    (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      // Not `?? ''`: an empty key builds a link that opens the editor but
      // silently activates nothing, which looks like the extension is broken.
      if (!app.env.SHOPIFY_API_KEY) throw new AppError('CONFIG', 500, 'SHOPIFY_API_KEY missing');
      return { url: buildThemeEditorDeepLink(store.shopDomain, app.env.SHOPIFY_API_KEY) };
    },
  );
}
