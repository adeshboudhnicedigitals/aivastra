import { describe, expect, it, vi } from 'vitest';

describe('requireShopifyStoreKey', () => {
  it('throws UNAUTHORIZED when x-widget-key header is missing', async () => {
    const { shopifyWidgetAuthPlugin } = await import('./shopify-widget-auth.js');
    const decorated: Record<string, unknown> = {};
    const app = {
      decorate: (name: string, fn: unknown) => {
        decorated[name] = fn;
      },
      db: { select: vi.fn() },
    };
    // biome-ignore lint/suspicious/noExplicitAny: test mock — Fastify plugin type is opaque
    await (shopifyWidgetAuthPlugin as any)(app, {}, () => {});
    const req = { headers: {} } as never;
    await expect(
      (decorated.requireShopifyStoreKey as (req: unknown) => Promise<void>)(req),
    ).rejects.toThrow('Missing X-Widget-Key header');
  });
});
