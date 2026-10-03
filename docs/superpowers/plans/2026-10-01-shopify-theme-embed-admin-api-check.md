# Shopify Theme Embed Admin API Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Shopify onboarding theme page's "Refresh status" button confirm the app embed is live by asking Shopify's Admin API directly, instead of only waiting for a shopper to load a real storefront product page.

**Architecture:** Add the `read_themes` scope, then add a live Admin GraphQL check (`checkThemeEmbedLive`) that reads the published theme's `config/settings_data.json` and looks for our embed block's `disabled` flag. Wire it into a new on-demand route, `POST /v1/shopify/onboarding/check-theme-embed`, which the existing "Refresh status" button calls before refreshing `/v1/shopify/me`. The existing storefront-ping path (`markThemeEmbedSeen`, fired from the widget's `/enabled` call) is untouched and keeps working as a free fallback for stores that have not yet re-consented to the new scope.

**Tech Stack:** Fastify 5, Drizzle ORM, Shopify Admin GraphQL API (`2026-07`), Vitest integration tests against a real Postgres/Redis via `apps/api/test/helpers/containers.ts`, React/Polaris SPA (`apps/shopify`).

## Global Constraints

- Never throw out of the new check path — any failure (missing scope, network error, malformed JSON, no main theme) must degrade to "not detected yet," never a 500 and never `SHOPIFY_REAUTH_REQUIRED`. `shopifyGraphQL` only maps HTTP 401/403 to that error; a missing-scope GraphQL refusal comes back as HTTP 200 with a `body.errors` entry, which already avoids that trap as long as the call is wrapped in try/catch.
- Reuse `shopifyGraphQL` / `getValidAccessToken` from `apps/api/src/modules/shopify/service.ts` and `token.ts` — never a raw `fetch()` to Shopify.
- The new route must not run on every `/v1/shopify/me` poll (that route is hit on every SPA navigation per its own comments) — it is a separate, on-demand endpoint the "Refresh status" button calls explicitly.
- `settings_data.json`'s content can carry a leading `/* ... */` comment block that breaks `JSON.parse` — strip it before parsing (verified against a working community implementation, not assumed).
- Match existing file organization: the new helper and route live in `apps/api/src/modules/shopify/onboarding.routes.ts`, next to `TRYON_BLOCK_HANDLE`, `buildThemeEditorDeepLink`, and `markThemeEmbedSeen`, which it directly extends.

---

### Task 1: Add the `read_themes` scope

**Files:**
- Modify: `apps/shopify-extension/shopify.app.toml:24`
- Modify: `apps/shopify-extension/shopify.app.staging.toml:20`
- Modify: `apps/shopify-extension/shopify.app.dev.toml:17`
- Modify: `apps/api/src/env.ts:76`
- Modify: `.env.staging.example:96`
- Modify: `.env.production.example:183`

**Interfaces:**
- Produces: the registered scope set `read_products,write_products,read_themes`, which `checkThemeEmbedLive` (Task 3) depends on to ever succeed for a re-consented store.

- [ ] **Step 1: Confirm current scope strings (sanity check, not a test)**

Run: `grep -n "scopes = " apps/shopify-extension/shopify.app*.toml`
Expected output (three lines, exact):
```
apps/shopify-extension/shopify.app.toml:scopes = "read_products,write_products"
apps/shopify-extension/shopify.app.staging.toml:scopes = "read_products,write_products"
apps/shopify-extension/shopify.app.dev.toml:scopes = "read_products,write_products"
```

- [ ] **Step 2: Update all three TOML files**

In `apps/shopify-extension/shopify.app.toml`, change line 24:
```toml
scopes = "read_products,write_products"
```
to:
```toml
scopes = "read_products,write_products,read_themes"
```

In `apps/shopify-extension/shopify.app.staging.toml`, change line 20 the same way.

In `apps/shopify-extension/shopify.app.dev.toml`, change line 17 the same way.

- [ ] **Step 3: Update the scope default in `apps/api/src/env.ts`**

Change line 76:
```ts
  SHOPIFY_SCOPES: z.string().default('read_products'),
```
to:
```ts
  SHOPIFY_SCOPES: z.string().default('read_products,write_products,read_themes'),
```

- [ ] **Step 4: Update the two `.env.*.example` files**

In `.env.staging.example`, change line 96:
```
SHOPIFY_SCOPES=read_products,write_products
```
to:
```
SHOPIFY_SCOPES=read_products,write_products,read_themes
```

In `.env.production.example`, change line 183:
```
SHOPIFY_SCOPES=read_products
```
to:
```
SHOPIFY_SCOPES=read_products,read_themes
```
(Leave `write_products` out here — that's a pre-existing gap between this file and the registered TOML scopes, unrelated to this change; don't fix it as a drive-by.)

- [ ] **Step 5: Verify**

Run: `grep -rn "read_themes" apps/shopify-extension/shopify.app*.toml apps/api/src/env.ts .env.staging.example .env.production.example`
Expected: 5 matching lines, one per file touched above.

- [ ] **Step 6: Commit**

```bash
git add apps/shopify-extension/shopify.app.toml apps/shopify-extension/shopify.app.staging.toml apps/shopify-extension/shopify.app.dev.toml apps/api/src/env.ts .env.staging.example .env.production.example
git commit -m "feat(shopify): add read_themes scope for live app-embed detection"
```

**Note for whoever deploys this:** `make shopify-deploy` / `make shopify-deploy-staging` publish the TOML scope change to Partner Dashboard. Every already-installed store will see Shopify's one-time "this app wants additional permissions" prompt next time they open the admin — this is expected and automatic, not something this code needs to orchestrate.

---

### Task 2: Pure parser — `findThemeEmbedEnabled`

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts`
- Test: `apps/api/test/integration/shopify-onboarding.test.ts`

**Interfaces:**
- Produces: `export function findThemeEmbedEnabled(content: string, apiKey: string): boolean` — pure, no I/O. `content` is the raw text of a theme's `config/settings_data.json`; `apiKey` is `app.env.SHOPIFY_API_KEY`. Returns `true` only if a block whose `type` starts with `` `shopify://apps/${apiKey}/blocks/tryon-button/` `` exists and its `disabled` field is not `true`.
- Consumes: `TRYON_BLOCK_HANDLE` (already defined at `onboarding.routes.ts:31`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/integration/shopify-onboarding.test.ts`, after the existing `buildThemeEditorDeepLink` describe block (after line 57):

```ts
describe('findThemeEmbedEnabled', () => {
  const API_KEY_UNDER_TEST = 'abc123';

  function settingsJson(blocks: Record<string, { type: string; disabled?: boolean }>): string {
    return JSON.stringify({ current: { blocks } });
  }

  it('is true when the block type matches our handle and disabled is absent', () => {
    const content = settingsJson({
      'block-1': { type: `shopify://apps/${API_KEY_UNDER_TEST}/blocks/tryon-button/uuid-1` },
    });
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(true);
  });

  it('is true when disabled is explicitly false', () => {
    const content = settingsJson({
      'block-1': {
        type: `shopify://apps/${API_KEY_UNDER_TEST}/blocks/tryon-button/uuid-1`,
        disabled: false,
      },
    });
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(true);
  });

  it('is false when disabled is true', () => {
    const content = settingsJson({
      'block-1': {
        type: `shopify://apps/${API_KEY_UNDER_TEST}/blocks/tryon-button/uuid-1`,
        disabled: true,
      },
    });
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(false);
  });

  it('is false when no block matches our handle', () => {
    const content = settingsJson({
      'block-1': { type: `shopify://apps/${API_KEY_UNDER_TEST}/blocks/some-other-embed/uuid-1` },
    });
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(false);
  });

  it('is false for a different app’s api key, even with the same block handle', () => {
    const content = settingsJson({
      'block-1': { type: 'shopify://apps/someone-elses-key/blocks/tryon-button/uuid-1' },
    });
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(false);
  });

  it('strips a leading /* ... */ comment block before parsing', () => {
    const json = settingsJson({
      'block-1': { type: `shopify://apps/${API_KEY_UNDER_TEST}/blocks/tryon-button/uuid-1` },
    });
    const content = `/* some editor-added comment\nspanning lines */\n${json}`;
    expect(findThemeEmbedEnabled(content, API_KEY_UNDER_TEST)).toBe(true);
  });

  it('is false (not a throw) on unparseable content', () => {
    expect(findThemeEmbedEnabled('not json at all', API_KEY_UNDER_TEST)).toBe(false);
  });
});
```

Add `findThemeEmbedEnabled` to the existing import at the top of the file (line 5):
```ts
import { buildThemeEditorDeepLink } from '../../src/modules/shopify/onboarding.routes.js';
```
becomes:
```ts
import {
  buildThemeEditorDeepLink,
  findThemeEmbedEnabled,
} from '../../src/modules/shopify/onboarding.routes.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-onboarding -t findThemeEmbedEnabled`
Expected: FAIL — `findThemeEmbedEnabled is not a function` (it does not exist yet).

- [ ] **Step 3: Implement in `apps/api/src/modules/shopify/onboarding.routes.ts`**

Add after the `TRYON_BLOCK_HANDLE` constant (after line 31, before `buildThemeEditorDeepLink`):

```ts
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
  const stripped = content.replace(/\/\*[\s\S]*?\*\//, '');
  let parsed: { current?: { blocks?: Record<string, { type?: string; disabled?: boolean }> } };
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return false;
  }
  const blocks = parsed.current?.blocks ?? {};
  const prefix = `shopify://apps/${apiKey}/blocks/${TRYON_BLOCK_HANDLE}/`;
  return Object.values(blocks).some(
    (block) =>
      typeof block.type === 'string' && block.type.startsWith(prefix) && block.disabled !== true,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding -t findThemeEmbedEnabled`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/test/integration/shopify-onboarding.test.ts
git commit -m "feat(shopify): add pure parser for app-embed enabled state in settings_data.json"
```

---

### Task 3: Live check + `POST /v1/shopify/onboarding/check-theme-embed`

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts`
- Test: `apps/api/test/integration/shopify-onboarding.test.ts`

**Interfaces:**
- Consumes: `findThemeEmbedEnabled(content, apiKey)` (Task 2), `shopifyGraphQL<T>(shopDomain, accessToken, query, variables)` and `getValidAccessToken(app, store)` (both already exported from `./service.js` and `./token.js`), `markThemeEmbedSeen(app, store)` (already in this file, line 73).
- Produces: `export async function checkThemeEmbedLive(app: FastifyInstance, store: typeof schema.shopifyStores.$inferSelect): Promise<boolean>` and the route `POST /v1/shopify/onboarding/check-theme-embed`, responding `{ themeEmbedConfirmed: boolean }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/integration/shopify-onboarding.test.ts`, after the `findThemeEmbedEnabled` describe block from Task 2:

```ts
describe('POST /v1/shopify/onboarding/check-theme-embed', () => {
  let confirmedStoreId: string;
  let confirmedToken: string;
  let freshStoreId: string;
  let freshToken: string;
  let disabledStoreId: string;
  let disabledToken: string;
  let scopeDeniedStoreId: string;
  let scopeDeniedToken: string;

  function themeFilesResponse(content: string): Response {
    return new Response(
      JSON.stringify({
        data: {
          themes: {
            nodes: [
              {
                files: {
                  nodes: [{ filename: 'config/settings_data.json', body: { content } }],
                },
              },
            ],
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function accessDeniedResponse(): Response {
    return new Response(
      JSON.stringify({
        errors: [
          {
            message: 'Access denied for themes field. Required access: `read_themes` access scope.',
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function settingsJson(disabled?: boolean): string {
    return JSON.stringify({
      current: {
        blocks: {
          'block-1': {
            type: `shopify://apps/${API_KEY}/blocks/tryon-button/uuid-1`,
            ...(disabled === undefined ? {} : { disabled }),
          },
        },
      },
    });
  }

  beforeAll(async () => {
    const confirmed = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 7701,
        shopDomain: 'confirmed.myshopify.com',
        myshopifyDomain: 'confirmed.myshopify.com',
        name: 'Confirmed',
        email: 'confirmed@o.com',
      },
      'tok',
      'read_products',
    );
    confirmedStoreId = confirmed.id;
    confirmedToken = signSessionToken('confirmed.myshopify.com', API_SECRET, API_KEY);
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { themeEmbedConfirmed: true, themeBlockConfirmed: true } })
      .where(eq(schema.shopifyStores.id, confirmedStoreId));

    const fresh = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 7702,
        shopDomain: 'fresh.myshopify.com',
        myshopifyDomain: 'fresh.myshopify.com',
        name: 'Fresh',
        email: 'fresh@o.com',
      },
      'tok',
      'read_products,write_products,read_themes',
    );
    freshStoreId = fresh.id;
    freshToken = signSessionToken('fresh.myshopify.com', API_SECRET, API_KEY);

    const disabled = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 7703,
        shopDomain: 'disabled.myshopify.com',
        myshopifyDomain: 'disabled.myshopify.com',
        name: 'Disabled',
        email: 'disabled@o.com',
      },
      'tok',
      'read_products,write_products,read_themes',
    );
    disabledStoreId = disabled.id;
    disabledToken = signSessionToken('disabled.myshopify.com', API_SECRET, API_KEY);

    const scopeDenied = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 7704,
        shopDomain: 'scopedenied.myshopify.com',
        myshopifyDomain: 'scopedenied.myshopify.com',
        name: 'ScopeDenied',
        email: 'scopedenied@o.com',
      },
      'tok',
      'read_products',
    );
    scopeDeniedStoreId = scopeDenied.id;
    scopeDeniedToken = signSessionToken('scopedenied.myshopify.com', API_SECRET, API_KEY);
  });

  it('returns true immediately for an already-confirmed store, with no Shopify call', async () => {
    // No fetch stub installed — an accidental live call fails outright here.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/check-theme-embed',
      headers: { authorization: `Bearer ${confirmedToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ themeEmbedConfirmed: true });
  });

  it('confirms and persists when the Admin API shows the block enabled', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (String(url).includes('/graphql.json')) return themeFilesResponse(settingsJson());
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/shopify/onboarding/check-theme-embed',
        headers: { authorization: `Bearer ${freshToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ themeEmbedConfirmed: true });

      const [row] = await app.db
        .select({ settings: schema.shopifyStores.settings })
        .from(schema.shopifyStores)
        .where(eq(schema.shopifyStores.id, freshStoreId));
      expect(row.settings.themeEmbedConfirmed).toBe(true);
      expect(row.settings.themeBlockConfirmed).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reports false and writes nothing when the block is disabled', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (String(url).includes('/graphql.json')) return themeFilesResponse(settingsJson(true));
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/shopify/onboarding/check-theme-embed',
        headers: { authorization: `Bearer ${disabledToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ themeEmbedConfirmed: false });

      const [row] = await app.db
        .select({ settings: schema.shopifyStores.settings })
        .from(schema.shopifyStores)
        .where(eq(schema.shopifyStores.id, disabledStoreId));
      expect(row.settings.themeEmbedConfirmed ?? false).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('degrades to false, not a 500, when the store has not re-consented to read_themes', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (String(url).includes('/graphql.json')) return accessDeniedResponse();
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/shopify/onboarding/check-theme-embed',
        headers: { authorization: `Bearer ${scopeDeniedToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ themeEmbedConfirmed: false });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding -t check-theme-embed`
Expected: FAIL — `404` (route does not exist yet) on every case.

- [ ] **Step 3: Implement in `apps/api/src/modules/shopify/onboarding.routes.ts`**

Add to the top imports (after line 7, the `settings-json.js` import):
```ts
import { shopifyGraphQL } from './service.js';
import { getValidAccessToken } from './token.js';
```

Add after `findThemeEmbedEnabled` (from Task 2) and before `buildThemeEditorDeepLink`:

```ts
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
  const apiKey = app.env.SHOPIFY_API_KEY;
  if (!apiKey) return false;
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
    return findThemeEmbedEnabled(content, apiKey);
  } catch (err) {
    app.log.warn({ err, storeId: store.id }, 'theme embed live-check failed');
    return false;
  }
}
```

Add the route at the end of `shopifyOnboardingRoutes`, after the `theme-editor-url` route (after line 228, before the closing `}` of the function):

```ts
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
      if (confirmed) await markThemeEmbedSeen(app, store);
      return { themeEmbedConfirmed: confirmed };
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding -t check-theme-embed`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full onboarding integration file to check for regressions**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding`
Expected: PASS — all tests in the file, including the pre-existing ones from before this plan.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/test/integration/shopify-onboarding.test.ts
git commit -m "feat(shopify): add live Admin API check for app-embed status"
```

---

### Task 4: Update comments that claimed we don't hold `read_themes`

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts:33-53` (JSDoc on `buildThemeEditorDeepLink`)
- Modify: `apps/api/test/integration/shopify-onboarding.test.ts:52-56` (test title/body)
- Modify: `apps/api/test/integration/shopify-onboarding.test.ts:60-62` (comment)

These comments documented a true fact as of Task 1's start — "this app does not request `read_themes`" — which Task 1 just made false. Left alone, they'd actively mislead the next reader into thinking `checkThemeEmbedLive` is impossible.

**Interfaces:**
- None — doc/test-title only, no behavior change. The underlying assertions (this specific route never calls the Admin API) stay true and stay tested.

- [ ] **Step 1: Update the JSDoc in `apps/api/src/modules/shopify/onboarding.routes.ts`**

Replace (current lines 33-53):
```ts
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
```

with:
```ts
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
```

- [ ] **Step 2: Update the test file**

In `apps/api/test/integration/shopify-onboarding.test.ts`, replace (current lines 52-56):
```ts
  it('never needs a theme ID — that lookup requires the read_themes scope we do not hold', () => {
    const url = buildThemeEditorDeepLink('o.myshopify.com', 'abc123');
    expect(url).toContain('/themes/current/');
    expect(url).not.toMatch(/\/themes\/\d+\//);
  });
```
with:
```ts
  it('never needs a theme ID — avoids a REST lookup that would 403 pre-consent', () => {
    const url = buildThemeEditorDeepLink('o.myshopify.com', 'abc123');
    expect(url).toContain('/themes/current/');
    expect(url).not.toMatch(/\/themes\/\d+\//);
  });
```

Replace (current lines 60-62):
```ts
  it('returns the deep link without calling the Shopify Admin API', async () => {
    // A real fetch here would 403 for want of read_themes; the route is pure, so
    // this passes with no network stub in place at all.
```
with:
```ts
  it('returns the deep link without calling the Shopify Admin API', async () => {
    // Route is pure string-building — no fetch stub needed; an accidental
    // live call would fail outright in this sandboxed test environment.
```

- [ ] **Step 3: Run the file to confirm nothing broke**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding`
Expected: PASS — same test count as Task 3's Step 5, renamed test included.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/test/integration/shopify-onboarding.test.ts
git commit -m "docs(shopify): correct comments claiming we don't hold read_themes"
```

---

### Task 5: Wire the "Refresh status" button to the new check

**Files:**
- Modify: `apps/shopify/src/pages/OnboardingThemePage.tsx`

**Interfaces:**
- Consumes: `POST /v1/shopify/onboarding/check-theme-embed` (Task 3), via the already-imported `apiFetch` from `../lib/api`.

- [ ] **Step 1: Update `checkStatus` (current lines 79-90)**

Replace:
```tsx
  async function checkStatus() {
    setChecking(true);
    setError(null);
    try {
      await onRefresh();
      setCheckedNotFound(true);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setChecking(false);
    }
  }
```
with:
```tsx
  async function checkStatus() {
    setChecking(true);
    setError(null);
    try {
      // Live Admin API check first (writes themeEmbedConfirmed server-side if
      // it finds the embed on) — onRefresh then pulls whatever that just set,
      // same as it already did for the storefront-ping path.
      await apiFetch('/v1/shopify/onboarding/check-theme-embed', { method: 'POST' });
      await onRefresh();
      setCheckedNotFound(true);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setChecking(false);
    }
  }
```

- [ ] **Step 2: Add a comment to the background poll explaining why it's untouched (current lines 60-74)**

Replace:
```tsx
  // The embed is switched on in another tab and detected the first time the
  // widget loads on a live product page, so there is nothing to click here —
  // just look again on a timer and whenever the merchant comes back to this tab.
  useEffect(() => {
```
with:
```tsx
  // The embed is switched on in another tab and detected the first time the
  // widget loads on a live product page, so there is nothing to click here —
  // just look again on a timer and whenever the merchant comes back to this tab.
  // Deliberately calls onRefresh (cheap, DB-only) rather than the Admin-API-
  // backed check-theme-embed endpoint above — polling Shopify's Admin API
  // automatically every 5s for every merchant with this tab open would burn
  // API rate-limit budget for no benefit; that check is reserved for the
  // explicit, human-paced "Refresh status" click.
  useEffect(() => {
```

- [ ] **Step 3: Soften the copy that told merchants to visit their storefront (current lines 220-231)**

Replace:
```tsx
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">
                        If Save is greyed out, it's already enabled. Then open any product page on
                        your store and press Refresh status — we'll detect the button and unlock
                        Finish Setup.
                      </Text>
                      {checkedNotFound && (
                        <Text as="p" tone="caution">
                          Not detected yet. Make sure the embed is saved, then load a product page
                          on your live store (not the theme editor preview) and refresh again.
                        </Text>
                      )}
                    </BlockStack>
```
with:
```tsx
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">
                        If Save is greyed out, it's already enabled. Press Refresh status and
                        we'll detect it automatically.
                      </Text>
                      {checkedNotFound && (
                        <Text as="p" tone="caution">
                          Not detected yet. Make sure the embed is saved, then try Refresh status
                          again in a moment — or open any product page on your live store (not the
                          theme editor preview), which also confirms it automatically.
                        </Text>
                      )}
                    </BlockStack>
```

- [ ] **Step 4: Typecheck**

Run (from repo root): `pnpm --filter @aivastra/shopify-admin typecheck`
Expected: no output beyond the `tsc -b` invocation — exits 0.

(If this exact script name differs, confirm with `grep -n '"typecheck"' apps/shopify/package.json` first — `apps/shopify`'s package name is `@aivastra/shopify-admin`, not `@aivastra/shopify`.)

- [ ] **Step 5: Run the shopify app's unit tests**

Run: `pnpm --filter @aivastra/shopify-admin test`
Expected: PASS — same count as before this task (this change has no new unit-testable logic of its own; `findThemeEmbedEnabled` and the route are already covered by Task 2/3's integration tests).

- [ ] **Step 6: Manual verification**

Start the dev stack (`pnpm dev` or the individual `api`/`shopify` filters) and open the onboarding theme page for a test store that has already re-consented to `read_themes` in a dev/staging environment. Toggle the embed on in the theme editor, save, return to the admin tab, click "Refresh status" — it should flip to confirmed without ever opening the storefront. Note in your own testing notes whether the store had re-consented; a pre-consent store will still require the storefront-ping fallback, which is expected per this plan, not a bug.

- [ ] **Step 7: Commit**

```bash
git add apps/shopify/src/pages/OnboardingThemePage.tsx
git commit -m "feat(shopify): refresh status button checks the Admin API live, not just storefront pings"
```

---

## Self-Review

**Spec coverage:** Scope added (Task 1) → pure parser with verified JSON shape and comment-stripping (Task 2) → live check + route with graceful degradation on every failure mode including missing scope (Task 3) → stale comments correctedso the codebase doesn't contradict itself (Task 4) → frontend wired to call it, old storefront-only copy softened, background poll explicitly left alone with a reason (Task 5). All covered.

**Placeholder scan:** No TBD/TODO, no "add error handling" hand-waves — every catch block's behavior is spelled out (return `false`, log `warn`, never throw). No "similar to Task N" — Task 3 and Task 5 both write out full code even though they build on Task 2/3's exports.

**Type consistency:** `findThemeEmbedEnabled(content: string, apiKey: string): boolean` — same signature in its Task 2 definition and Task 3's `checkThemeEmbedLive` caller. `checkThemeEmbedLive(app: FastifyInstance, store: typeof schema.shopifyStores.$inferSelect): Promise<boolean>` — same signature in its Task 3 definition and the route that calls it. The route response shape `{ themeEmbedConfirmed: boolean }` matches what Task 5's frontend expects (it doesn't even read the body, just awaits the call before `onRefresh()`, so there's no shape coupling risk there).
