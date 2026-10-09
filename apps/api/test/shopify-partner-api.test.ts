import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOneTimeSales,
  numericChargeId,
  PartnerApiError,
} from '../src/modules/shopify/partner-api.js';

const env = { SHOPIFY_PARTNER_API_TOKEN: 'tok', SHOPIFY_PARTNER_ORG_ID: '1234567' };
const since = new Date('2026-10-08T00:00:00Z');

function page(nodes: unknown[], hasNextPage = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        transactions: {
          edges: nodes.map((node, i) => ({ cursor: `c${i}`, node })),
          pageInfo: { hasNextPage },
        },
      },
    }),
    text: async () => '',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('numericChargeId', () => {
  it('strips a gid down to its number', () => {
    expect(numericChargeId('gid://shopify/AppPurchaseOneTime/3321168113')).toBe('3321168113');
  });
  it('leaves a bare number alone', () => {
    expect(numericChargeId('3321168113')).toBe('3321168113');
  });
});

describe('fetchOneTimeSales', () => {
  it('throws missing_config without a token or org id, and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      fetchOneTimeSales(
        { SHOPIFY_PARTNER_API_TOKEN: undefined, SHOPIFY_PARTNER_ORG_ID: '1' },
        { since },
      ),
    ).rejects.toMatchObject({ reason: 'missing_config' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps sales by numeric charge id and sends the token header to the org endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      page([
        {
          id: 't1',
          createdAt: '2026-10-09T06:39:29Z',
          chargeId: 'gid://shopify/AppPurchaseOneTime/3321168113',
        },
        { id: 't2', createdAt: '2026-10-09T07:00:00Z', chargeId: null },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const sales = await fetchOneTimeSales(env, { since, shop: 'x.myshopify.com' });

    expect(sales.get('3321168113')?.paidAt.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(sales.size).toBe(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://partners.shopify.com/1234567/api/2026-10/graphql.json');
    expect(init.headers['X-Shopify-Access-Token']).toBe('tok');
    const body = JSON.parse(init.body);
    expect(body.variables).toMatchObject({
      types: ['APP_ONE_TIME_SALE'],
      shop: 'x.myshopify.com',
      since: '2026-10-08T00:00:00.000Z',
    });
  });

  it('follows pagination with the last cursor', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        page([{ id: 'a', createdAt: '2026-10-09T00:00:00Z', chargeId: '1' }], true),
      )
      .mockResolvedValueOnce(page([{ id: 'b', createdAt: '2026-10-09T00:00:00Z', chargeId: '2' }]));
    vi.stubGlobal('fetch', fetchSpy);

    const sales = await fetchOneTimeSales(env, { since });

    expect([...sales.keys()].sort()).toEqual(['1', '2']);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).variables.after).toBe('c0');
  });

  it('throws rate_limited on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }),
    );
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('throws http on other non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' }),
    );
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({ reason: 'http' });
  });

  it('throws http when fetch itself rejects (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(fetchOneTimeSales(env, { since })).rejects.toBeInstanceOf(PartnerApiError);
  });

  it('throws graphql on a GraphQL errors array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: 'Access denied' }] }),
        text: async () => '',
      }),
    );
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({ reason: 'graphql' });
  });
});
