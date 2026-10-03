import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { grantShopifyEmailBonus, storeBalance } from './purchase.js';
import { shopifyGraphQL } from './service.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';
import { getValidAccessToken } from './token.js';

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
 * strings look like `shopify://apps/{app_identifier}/blocks/{handle}/{uid}`,
 * and matching is deliberately scoped to the `/blocks/{handle}/` segment only,
 * never the app identifier — direct probing against a real store found
 * `app.env.SHOPIFY_API_KEY` (the client_id), the Admin API's own `app.handle`
 * query, and the literal identifier Shopify baked into that store's live
 * block type were three different strings. None of them can be trusted to
 * compute a matching prefix, so this only verifies the block handle — which
 * this extension names and fully controls — is present; a collision with
 * another app's identically-named block isn't worth guarding against.
 * A block with no `disabled` key is enabled by Shopify's own convention —
 * only an explicit `disabled: true` turns it off.
 *
 * Never throws — every malformed shape, including a non-object root, a leading
 * comment this strip misses, or null/non-object block entries, returns false.
 */
export function findThemeEmbedEnabled(content: string): boolean {
  try {
    const stripped = content.replace(/^\s*\/\*[\s\S]*?\*\//, '');
    const parsed: unknown = JSON.parse(stripped);
    const blocks =
      (parsed as { current?: { blocks?: Record<string, unknown> } } | null)?.current?.blocks ?? {};
    const blockPattern = new RegExp(`^shopify://apps/[^/]+/blocks/${TRYON_BLOCK_HANDLE}/`);
    return Object.values(blocks).some((block) => {
      if (typeof block !== 'object' || block === null) return false;
      const typed = block as { type?: unknown; disabled?: unknown };
      return (
        typeof typed.type === 'string' && blockPattern.test(typed.type) && typed.disabled !== true
      );
    });
  } catch {
    return false;
  }
}

const MAIN_THEME_SETTINGS_QUERY = `
  query MainThemeSettingsData($filenames: [String!]!) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        files(filenames: $filenames) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

interface MainThemeSettingsData {
  themes: {
    nodes: Array<{
      files: {
        nodes: Array<{ filename: string; body: { content?: string } | null }>;
      };
    }>;
  };
}

/**
 * Live Admin API check for whether the app embed is switched on in the
 * merchant's published theme — an on-demand alternative to waiting for a
 * shopper to actually load a storefront page (see markThemeEmbedSeen below).
 * Needs `read_themes`. A store that has not yet seen Shopify's one-time
 * "additional permissions" prompt gets ACCESS_DENIED back from Shopify as a
 * normal GraphQL error (HTTP 200, not 401/403), so this never risks tripping
 * shopifyAdminFetch's SHOPIFY_REAUTH_REQUIRED mapping — every failure mode
 * here, scope included, is just logged and reported as "not detected".
 */
export async function checkThemeEmbedLive(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<boolean> {
  try {
    const accessToken = await getValidAccessToken(app, store);
    const data = await shopifyGraphQL<MainThemeSettingsData>(
      store.shopDomain,
      accessToken,
      MAIN_THEME_SETTINGS_QUERY,
      { filenames: ['config/settings_data.json'] },
    );
    const content = data.themes.nodes[0]?.files.nodes.find(
      (f) => f.filename === 'config/settings_data.json',
    )?.body?.content;
    if (!content) return false;
    return findThemeEmbedEnabled(content);
  } catch (err) {
    app.log.warn({ err, storeId: store.id }, 'theme embed live-check failed');
    return false;
  }
}

/**
 * Deep link into the merchant's live theme editor, opened on the App embeds
 * panel with our embed switched on (the merchant still has to press Save).
 *
 * Deliberately builds a URL instead of asking the Admin API for the theme ID,
 * even though the app now holds `read_themes` (added for checkThemeEmbedLive
 * below) — a REST `GET /themes.json?role=main` lookup here would still 403
 * for any store that has not yet seen Shopify's one-time scope-upgrade
 * prompt, and `shopifyAdminFetch` turns every 403 into SHOPIFY_REAUTH_REQUIRED,
 * bouncing the merchant through a pointless reauth on the one button new
 * merchants are told to press first. `themes/current` sidesteps the whole
 * question for every store, re-consented or not.
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

  // On-demand alternative to waiting for a shopper's storefront visit — the
  // "Refresh status" button on the onboarding theme page calls this before
  // re-reading /v1/shopify/me, so a merchant never has to leave the admin.
  // Deliberately its own route, not folded into /v1/shopify/me: that route is
  // hit on every SPA navigation, and a live Shopify call has no place there.
  app.post(
    '/v1/shopify/onboarding/check-theme-embed',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      if (store.settings?.themeEmbedConfirmed) return { themeEmbedConfirmed: true };
      const confirmed = await checkThemeEmbedLive(app, store);
      if (confirmed) {
        await markThemeEmbedSeen(app, store).catch((err) =>
          app.log.warn({ err, storeId: store.id }, 'could not persist app embed as seen'),
        );
      }
      return { themeEmbedConfirmed: confirmed };
    },
  );
}
