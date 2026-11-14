import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendShopifyInstallNotifyEmail, sendShopifyWelcomeEmail } from '../../src/lib/mailer.js';
import { provisionShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return {
    ...actual,
    sendShopifyWelcomeEmail: vi.fn().mockResolvedValue(undefined),
    sendShopifyInstallNotifyEmail: vi.fn().mockResolvedValue(undefined),
  };
});

const shop = vi.hoisted(() => ({ id: 636363, domain: 'notify-test' }));
vi.mock('../../src/modules/shopify/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/shopify/service.js')>();
  return {
    ...actual,
    shopifyGraphQL: vi.fn().mockImplementation(async () => ({
      shop: {
        id: `gid://shopify/Shop/${shop.id}`,
        name: 'Notify Test',
        email: 'owner@example.com',
        myshopifyDomain: `${shop.domain}.myshopify.com`,
        createdAt: '2026-11-13T12:15:00Z',
        shopOwnerName: 'Asha Rao',
        billingAddress: { phone: '+91 98765 43210', country: 'India' },
        plan: { partnerDevelopment: false },
      },
    })),
  };
});

const ENC_KEY = Buffer.alloc(32, 12).toString('base64');
let ctx: Containers;
let app: TestApp;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_INSTALL_NOTIFY_EMAILS: 'ops@example.com, not-an-email, founder@example.com',
  });
});
afterAll(async () => {
  await app.close();
  await ctx.stop();
});
beforeEach(() => vi.mocked(sendShopifyInstallNotifyEmail).mockClear());

const provision = () =>
  provisionShopifyStore(
    app,
    `${shop.domain}.myshopify.com`,
    'tok',
    'read_products',
    undefined,
    log,
  );

describe('shopify install operator notification', () => {
  it('mails the configured recipients once on first install, not on reinstall', async () => {
    await provision();
    expect(sendShopifyInstallNotifyEmail).toHaveBeenCalledTimes(1);
    const [, , to, notice] = vi.mocked(sendShopifyInstallNotifyEmail).mock.calls[0];
    expect(to).toEqual(['ops@example.com', 'founder@example.com']);
    expect(notice.shopDomain).toBe('notify-test.myshopify.com');
    expect(notice.shopName).toBe('Notify Test');
    expect(notice.country).toBe('India');
    expect(notice.phone).toBe('+91 98765 43210');
    expect(notice.shopCreatedAt).toBe('2026-11-13T12:15:00Z');

    await provision();
    expect(sendShopifyInstallNotifyEmail).toHaveBeenCalledTimes(1);
  });

  it('a failing notification does not fail provisioning or the welcome mail', async () => {
    shop.id = 737373;
    shop.domain = 'notify-fail';
    vi.mocked(sendShopifyWelcomeEmail).mockClear();
    vi.mocked(sendShopifyInstallNotifyEmail).mockRejectedValueOnce(new Error('resend down'));
    await expect(provision()).resolves.toBeTruthy();
    expect(sendShopifyWelcomeEmail).toHaveBeenCalledTimes(1);
  });
});
