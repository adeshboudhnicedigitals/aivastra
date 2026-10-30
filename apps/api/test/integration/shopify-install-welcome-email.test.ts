import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendShopifyWelcomeEmail } from '../../src/lib/mailer.js';
import { provisionShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return { ...actual, sendShopifyWelcomeEmail: vi.fn().mockResolvedValue(undefined) };
});

// The shop-details query is the only Shopify call provisioning needs for this
// assertion; the later mirror/webhook steps are tolerant of failing.
const shop = vi.hoisted(() => ({ id: 424242, domain: 'welcome-test', email: 'owner@example.com' }));
vi.mock('../../src/modules/shopify/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/shopify/service.js')>();
  return {
    ...actual,
    shopifyGraphQL: vi.fn().mockImplementation(async () => ({
      shop: {
        id: `gid://shopify/Shop/${shop.id}`,
        name: 'Welcome Test',
        email: shop.email,
        myshopifyDomain: `${shop.domain}.myshopify.com`,
        shopOwnerName: 'Asha Rao',
        billingAddress: null,
        plan: { partnerDevelopment: false },
      },
    })),
  };
});

const ENC_KEY = Buffer.alloc(32, 11).toString('base64');
let ctx: Containers;
let app: TestApp;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY });
});
afterAll(async () => {
  await app.close();
  await ctx.stop();
});
beforeEach(() => vi.mocked(sendShopifyWelcomeEmail).mockClear());

const provision = () =>
  provisionShopifyStore(
    app,
    `${shop.domain}.myshopify.com`,
    'tok',
    'read_products',
    undefined,
    log,
  );

describe('shopify install welcome email', () => {
  it('sends once on first install to the shop email, not again on reinstall', async () => {
    await provision();
    expect(sendShopifyWelcomeEmail).toHaveBeenCalledTimes(1);
    const [, , to, params] = vi.mocked(sendShopifyWelcomeEmail).mock.calls[0];
    expect(to).toBe('owner@example.com');
    expect(params.name).toBe('Asha Rao');
    expect(params.freeTryOns).toBeGreaterThan(0);

    await provision();
    expect(sendShopifyWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('a failing send does not fail provisioning', async () => {
    shop.id = 515151;
    shop.domain = 'welcome-fail';
    vi.mocked(sendShopifyWelcomeEmail).mockRejectedValueOnce(new Error('resend down'));
    await expect(provision()).resolves.toBeTruthy();
    expect(sendShopifyWelcomeEmail).toHaveBeenCalledTimes(1);
  });
});
