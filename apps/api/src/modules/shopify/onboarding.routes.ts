import { schema } from '@aivastra/db';
import {
  PHONE_CHARS_RE,
  PHONE_MAX_LENGTH,
  PHONE_MIN_DIGITS,
  phoneDigitCount,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { grantShopifyEmailBonus, storeBalance } from './purchase.js';
import { shopifyGraphQL } from './service.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';
import { getValidAccessToken } from './token.js';

// Onboarding's contact step. Name, email and phone are all required. The phone is
// a number to ring in an emergency, not free text, so it is digits and the usual
// separators with at least PHONE_MIN_DIGITS digits (the same rule the page
// applies, so a value the form lets through is not bounced here).
const SaveContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .min(1, 'phone number is required')
    .max(PHONE_MAX_LENGTH)
    .regex(PHONE_CHARS_RE, 'phone number may only contain digits and + ( ) - .')
    .refine((v) => phoneDigitCount(v) >= PHONE_MIN_DIGITS, {
      message: `phone number needs at least ${PHONE_MIN_DIGITS} digits`,
    }),
});

/**
 * Handle of the app embed, i.e. the filename of
 * `apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button.liquid`
 * minus its extension. Renaming that file silently breaks this deep link —
 * Shopify just opens the editor without switching the embed on.
 */
const TRYON_BLOCK_HANDLE = 'tryon-button';

/**
 * Handle of the optional app block, `blocks/tryon-button-block.liquid`. Same
 * rename trap as the embed handle above. When present on a product page it wins
 * over the embed (tryon-widget.js drops the embed's button).
 */
const TRYON_APP_BLOCK_HANDLE = 'tryon-button-block';

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

/**
 * Pure parse: does the live theme's `templates/product.json` place our button
 * block, enabled? App blocks live in a section's `blocks`, typed
 * `shopify://apps/{app}/blocks/{handle}/{uid}`; only the block handle is
 * matched because Shopify's app identifier is not stable. Only an explicit
 * `disabled: true` turns a block off. Never throws.
 */
export function findThemeBlockPresent(content: string): boolean {
  try {
    const stripped = content.replace(/^\s*\/\*[\s\S]*?\*\//, '');
    const parsed: unknown = JSON.parse(stripped);
    const sections = (parsed as { sections?: Record<string, unknown> } | null)?.sections ?? {};
    const pattern = new RegExp(`^shopify://apps/[^/]+/blocks/${TRYON_APP_BLOCK_HANDLE}/`);
    return Object.values(sections).some((section) => {
      if (typeof section !== 'object' || section === null) return false;
      const blocks = (section as { blocks?: Record<string, unknown> }).blocks ?? {};
      return Object.values(blocks).some((block) => {
        if (typeof block !== 'object' || block === null) return false;
        const typed = block as { type?: unknown; disabled?: unknown };
        return (
          typeof typed.type === 'string' && pattern.test(typed.type) && typed.disabled !== true
        );
      });
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
 * shopper to actually load a storefront page (see markThemeSurfaceSeen below).
 * Needs `read_themes`. A store that has not yet seen Shopify's one-time
 * "additional permissions" prompt gets ACCESS_DENIED back from Shopify as a
 * normal GraphQL error (HTTP 200, not 401/403), so this never risks tripping
 * shopifyAdminFetch's SHOPIFY_REAUTH_REQUIRED mapping — every failure mode
 * here, scope included, is just logged and reported as "not detected".
 */
export async function checkThemeLive(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<{ block: boolean; embed: boolean }> {
  try {
    const accessToken = await getValidAccessToken(app, store);
    const data = await shopifyGraphQL<MainThemeSettingsData>(
      store.shopDomain,
      accessToken,
      MAIN_THEME_SETTINGS_QUERY,
      { filenames: ['config/settings_data.json', 'templates/product.json'] },
    );
    const files = data.themes.nodes[0]?.files.nodes ?? [];
    const embedContent = files.find((f) => f.filename === 'config/settings_data.json')?.body
      ?.content;
    const blockContent = files.find((f) => f.filename === 'templates/product.json')?.body?.content;
    return {
      embed: embedContent ? findThemeEmbedEnabled(embedContent) : false,
      block: blockContent ? findThemeBlockPresent(blockContent) : false,
    };
  } catch (err) {
    app.log.warn({ err, storeId: store.id }, 'theme live-check failed');
    return { block: false, embed: false };
  }
}

/**
 * Deep link into the merchant's live theme editor, opened on the App embeds
 * panel with our embed left off. The product-image icon is optional, so the
 * merchant switches it on themselves rather than us passing `activateAppId`
 * (which would flip it on and leave only Save).
 *
 * Deliberately builds a URL instead of asking the Admin API for the theme ID,
 * even though the app now holds `read_themes` (added for checkThemeLive
 * below) — a REST `GET /themes.json?role=main` lookup here would still 403
 * for any store that has not yet seen Shopify's one-time scope-upgrade
 * prompt, and `shopifyAdminFetch` turns every 403 into SHOPIFY_REAUTH_REQUIRED,
 * bouncing the merchant through a pointless reauth on the one button new
 * merchants are told to press first. `themes/current` sidesteps the whole
 * question for every store, re-consented or not.
 *
 * `themes/current` resolves the published theme server-side, so no theme ID is
 * needed. `context=apps` opens the App embeds panel; `template=product` makes the preview a product
 * page, which is the only page the embed draws on. History: this was an
 * `addAppBlockId` app-block link from 2026-07-31 until the embed came back;
 * blocks are placed by the merchant, embeds are injected globally by Shopify,
 * and the two use different parameters.
 */
export function buildThemeEditorDeepLink(shopDomain: string): string {
  return `https://${shopDomain}/admin/themes/current/editor?context=apps&template=product`;
}

/**
 * Deep link that opens the product template in the theme editor with the Try It
 * On app block staged, for merchants who want the button at an exact spot
 * instead of the embed's automatic placement. Offered from Settings only, after
 * onboarding — onboarding itself still sends merchants to the embed. The
 * merchant drags the staged block where they want it and presses Save.
 * `addAppBlockId` is `{client_id}/{block handle}`.
 */
export function buildAppBlockDeepLink(shopDomain: string, apiKey: string): string {
  return (
    `https://${shopDomain}/admin/themes/current/editor` +
    `?template=product&addAppBlockId=${apiKey}/${TRYON_APP_BLOCK_HANDLE}&target=mainSection`
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
export type ThemeSeenSource = 'block' | 'embed';

/**
 * Records which storefront surface is live. `block` ends onboarding and marks
 * the button block as seen; `embed` only marks the corner icon as seen.
 */
export async function markThemeSurfaceSeen(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  source: ThemeSeenSource,
): Promise<void> {
  const settings = store.settings ?? {};
  if (source === 'block' ? settings.themeButtonBlockSeen : settings.themeEmbedConfirmed) return;
  const patch =
    source === 'block'
      ? { themeBlockConfirmed: true, themeButtonBlockSeen: true }
      : { themeEmbedConfirmed: true };
  await app.db
    .update(schema.shopifyStores)
    .set({
      settings: mergeStoreSettingsObject(storeSettingsJson(), [], patch),
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
          shopPhone: phone,
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
      const firstCompletion = !(store.settings.onboardingCompletedOnce ?? false);
      const withActivation =
        firstCompletion && !store.settings.activation?.mode
          ? mergeStoreSettingsObject(storeSettingsJson(), ['activation'], { mode: 'global' })
          : storeSettingsJson();
      const settings = mergeStoreSettingsObject(withActivation, [], {
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
      const blockUrl = buildAppBlockDeepLink(store.shopDomain, app.env.SHOPIFY_API_KEY);
      const embedUrl = buildThemeEditorDeepLink(store.shopDomain);
      return { url: blockUrl, blockUrl, embedUrl };
    },
  );

  app.get('/v1/shopify/theme-block-url', { preHandler: app.requireShopifySession }, (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    if (!app.env.SHOPIFY_API_KEY) throw new AppError('CONFIG', 500, 'SHOPIFY_API_KEY missing');
    return { url: buildAppBlockDeepLink(store.shopDomain, app.env.SHOPIFY_API_KEY) };
  });

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
      const settings = store.settings ?? {};
      if (settings.themeButtonBlockSeen && settings.themeEmbedConfirmed) {
        return { themeBlockConfirmed: true, themeEmbedConfirmed: true };
      }
      const live = await checkThemeLive(app, store);
      const persist = (source: ThemeSeenSource) =>
        markThemeSurfaceSeen(app, store, source).catch((err) =>
          app.log.warn(
            { err, storeId: store.id, source },
            'could not persist theme surface as seen',
          ),
        );
      if (live.block) await persist('block');
      if (live.embed) await persist('embed');
      return {
        themeBlockConfirmed: Boolean(settings.themeButtonBlockSeen) || live.block,
        themeEmbedConfirmed: Boolean(settings.themeEmbedConfirmed) || live.embed,
      };
    },
  );
}
