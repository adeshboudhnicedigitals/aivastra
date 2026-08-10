import { describe, expect, it, vi } from 'vitest';
import { getActiveSubscription } from './partner-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const env = {
  SHOPIFY_PARTNER_API_TOKEN: 'partner-tok',
  SHOPIFY_PARTNER_ORG_ID: '999',
  SHOPIFY_PARTNER_APP_GID: 'gid://shopify/App/1234',
};

describe('getActiveSubscription', () => {
  it('POSTs to the org-scoped Partner API endpoint with the access token header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { activeSubscription: null } }));

    await getActiveSubscription(env, 5678, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://partners.shopify.com/999/api/2026-07/graphql.json');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': 'partner-tok',
    });
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({
      appId: 'gid://shopify/App/1234',
      shopId: 'gid://shopify/Shop/5678',
    });
  });

  it('returns null when the shop has no active subscription', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { activeSubscription: null } }));
    const result = await getActiveSubscription(env, 5678, fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('returns the parsed subscription when active', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          activeSubscription: {
            billingPeriod: 'EVERY_30_DAYS',
            cancelAtEndOfCycle: false,
            currentBillingCycle: {
              startTime: '2026-08-01T00:00:00Z',
              endTime: '2026-08-31T00:00:00Z',
            },
            items: [{ handle: 'growth' }],
          },
        },
      }),
    );
    const result = await getActiveSubscription(env, 5678, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      billingPeriod: 'EVERY_30_DAYS',
      cancelAtEndOfCycle: false,
      currentBillingCycle: {
        startTime: '2026-08-01T00:00:00Z',
        endTime: '2026-08-31T00:00:00Z',
      },
      items: [{ handle: 'growth' }],
    });
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      getActiveSubscription(env, 5678, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Partner API/);
  });

  it('throws when the GraphQL response carries errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: 'Invalid access token' }] }),
    );
    await expect(
      getActiveSubscription(env, 5678, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Invalid access token/);
  });
});
