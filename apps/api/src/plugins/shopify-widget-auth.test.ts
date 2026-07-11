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

  it('throws UNAUTHORIZED (not a raw DB error) when x-widget-key is not a valid UUID', async () => {
    const { shopifyWidgetAuthPlugin } = await import('./shopify-widget-auth.js');
    const decorated: Record<string, unknown> = {};
    const select = vi.fn();
    const app = {
      decorate: (name: string, fn: unknown) => {
        decorated[name] = fn;
      },
      db: { select },
    };
    // biome-ignore lint/suspicious/noExplicitAny: test mock — Fastify plugin type is opaque
    await (shopifyWidgetAuthPlugin as any)(app, {}, () => {});
    const req = { headers: { 'x-widget-key': 'not-a-uuid' } } as never;
    await expect(
      (decorated.requireShopifyStoreKey as (req: unknown) => Promise<void>)(req),
    ).rejects.toThrow('Invalid or inactive store key');
    // Must reject before ever touching the DB — a malformed uuid literal would
    // otherwise throw an unhandled Postgres error (500) instead of a clean 401.
    expect(select).not.toHaveBeenCalled();
  });
});
