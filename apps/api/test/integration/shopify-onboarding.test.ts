import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import {
  buildThemeEditorDeepLink,
  findThemeEmbedEnabled,
} from '../../src/modules/shopify/onboarding.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 12).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 77,
      shopDomain: 'o.myshopify.com',
      myshopifyDomain: 'o.myshopify.com',
      name: 'O',
      email: 'o@o.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('o.myshopify.com', API_SECRET, API_KEY);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('buildThemeEditorDeepLink', () => {
  it('targets themes/current and switches the app embed on', () => {
    expect(buildThemeEditorDeepLink('o.myshopify.com', 'abc123')).toBe(
      'https://o.myshopify.com/admin/themes/current/editor?context=apps&template=product&activateAppId=abc123/tryon-button',
    );
  });

  it('never needs a theme ID — that lookup requires the read_themes scope we do not hold', () => {
    const url = buildThemeEditorDeepLink('o.myshopify.com', 'abc123');
    expect(url).toContain('/themes/current/');
    expect(url).not.toMatch(/\/themes\/\d+\//);
  });
});

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

  it("is false for a different app's api key, even with the same block handle", () => {
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

  it('is false (not a throw) when parsed is null', () => {
    expect(findThemeEmbedEnabled('null', API_KEY_UNDER_TEST)).toBe(false);
  });

  it('is false (not a throw) when a block entry is null', () => {
    expect(findThemeEmbedEnabled('{"current":{"blocks":{"b1":null}}}', API_KEY_UNDER_TEST)).toBe(
      false,
    );
  });
});

describe('POST /v1/shopify/onboarding/check-theme-embed', () => {
  let confirmedStoreId: string;
  let confirmedToken: string;
  let freshStoreId: string;
  let freshToken: string;
  let disabledStoreId: string;
  let disabledToken: string;
  let _scopeDeniedStoreId: string;
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
    _scopeDeniedStoreId = scopeDenied.id;
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

describe('GET /v1/shopify/onboarding/theme-editor-url', () => {
  it('returns the deep link without calling the Shopify Admin API', async () => {
    // A real fetch here would 403 for want of read_themes; the route is pure, so
    // this passes with no network stub in place at all.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/onboarding/theme-editor-url',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe(
      `https://o.myshopify.com/admin/themes/current/editor?context=apps&template=product&activateAppId=${API_KEY}/tryon-button`,
    );
  });
});

describe('POST /v1/shopify/onboarding/confirm-theme-block', () => {
  it('is gone — the storefront ping replaced the manual confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-theme-block',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/shopify/onboarding/confirm-routing', () => {
  it('sets settings.onboardingRoutingConfirmed to true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.onboardingRoutingConfirmed).toBe(true);

    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings.onboardingRoutingConfirmed).toBe(true);
  });

  it('is idempotent — calling it twice does not error', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().settings.onboardingRoutingConfirmed).toBe(true);
  });
});

describe('POST /v1/shopify/onboarding/complete', () => {
  it('sets settings.onboardingCompletedOnce to true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/complete',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.onboardingCompletedOnce).toBe(true);

    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings.onboardingCompletedOnce).toBe(true);
  });

  it('is idempotent — calling it twice does not error', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/complete',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/complete',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().settings.onboardingCompletedOnce).toBe(true);
  });
});

describe('POST /v1/shopify/onboarding/contact', () => {
  function post(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/contact',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  async function storeRow() {
    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    return row;
  }

  it('saves name, email and phone onto the store row', async () => {
    const res = await post({
      name: '  Asha Rao ',
      email: 'asha@example.com',
      phone: '+91 98765 43210',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      shopOwnerName: 'Asha Rao',
      shopEmail: 'asha@example.com',
      shopPhone: '+91 98765 43210',
    });
    expect(await storeRow()).toMatchObject({
      shopOwnerName: 'Asha Rao',
      shopEmail: 'asha@example.com',
      shopPhone: '+91 98765 43210',
    });
  });

  it('stores a blank or missing phone as null, replacing an earlier one', async () => {
    await post({ name: 'Asha', email: 'asha@example.com', phone: '12345' });
    expect((await post({ name: 'Asha', email: 'asha@example.com', phone: '  ' })).statusCode).toBe(
      200,
    );
    expect((await storeRow()).shopPhone).toBeNull();
    await post({ name: 'Asha', email: 'asha@example.com', phone: '12345' });
    expect((await post({ name: 'Asha', email: 'asha@example.com' })).statusCode).toBe(200);
    expect((await storeRow()).shopPhone).toBeNull();
  });

  it('requires a name and a valid email, and rejects letters in the phone', async () => {
    expect((await post({ name: '   ', email: 'asha@example.com' })).statusCode).toBe(400);
    expect((await post({ email: 'asha@example.com' })).statusCode).toBe(400);
    expect((await post({ name: 'Asha', email: 'not-an-email' })).statusCode).toBe(400);
    expect(
      (await post({ name: 'Asha', email: 'asha@example.com', phone: 'call me' })).statusCode,
    ).toBe(400);
  });

  it('is served back on /me for prefilling', async () => {
    await post({ name: 'Asha Rao', email: 'asha@example.com', phone: '555 0100' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().store).toMatchObject({
      shopOwnerName: 'Asha Rao',
      shopEmail: 'asha@example.com',
      shopPhone: '555 0100',
    });
  });
});

describe('POST /v1/shopify/onboarding/welcome-credits', () => {
  // A store of its own, so the balance assertions start from zero.
  let bonusStoreId: string;
  let bonusToken: string;

  beforeAll(async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 78,
        shopDomain: 'p.myshopify.com',
        myshopifyDomain: 'p.myshopify.com',
        name: 'P',
        email: 'p@p.com',
      },
      'tok',
      'read_products',
    );
    bonusStoreId = store.id;
    bonusToken = signSessionToken('p.myshopify.com', API_SECRET, API_KEY);
  });

  async function balance() {
    const [row] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, bonusStoreId));
    return row?.balance ?? 0;
  }

  function post() {
    return app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/welcome-credits',
      headers: { authorization: `Bearer ${bonusToken}` },
    });
  }

  it("does not grant anything when contact details are saved — that is the Dashboard's job", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/contact',
      headers: { authorization: `Bearer ${bonusToken}` },
      payload: { name: 'Asha', email: 'asha@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('creditsGranted');
    expect(await balance()).toBe(0);
  });

  it('grants the configured welcome credits once, with no email or claim step', async () => {
    const first = await post();
    expect(first.statusCode).toBe(200);
    // 25 is the code default for shopify.trialCredits; the test app has no override.
    expect(first.json()).toMatchObject({ creditsGranted: 25, creditBalance: 25 });
    expect(await balance()).toBe(25);

    const [row] = await app.db
      .select({ settings: schema.shopifyStores.settings })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, bonusStoreId));
    expect(row.settings).toMatchObject({ emailBonusClaimed: true });

    // A reload or a second tab arriving on the Dashboard never grants twice.
    const second = await post();
    expect(second.json()).toMatchObject({ creditsGranted: 0, creditBalance: 25 });
    expect(await balance()).toBe(25);
  });

  it('is idempotent under two arrivals at once', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 79,
        shopDomain: 'q.myshopify.com',
        myshopifyDomain: 'q.myshopify.com',
        name: 'Q',
        email: 'q@q.com',
      },
      'tok',
      'read_products',
    );
    const headers = {
      authorization: `Bearer ${signSessionToken('q.myshopify.com', API_SECRET, API_KEY)}`,
    };
    const url = '/v1/shopify/onboarding/welcome-credits';
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url, headers }),
      app.inject({ method: 'POST', url, headers }),
    ]);
    expect(a.json().creditsGranted + b.json().creditsGranted).toBe(25);
    const [row] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(row.balance).toBe(25);
  });
});
