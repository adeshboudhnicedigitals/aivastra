import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppEventsToken,
  reportUsageEvent,
} from '../../src/modules/shopify/app-events-client.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('App Events client', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    // Clear the Redis cache before each test
    await app?.redis?.del('shopify:app-events:token');
  });

  it('fetches and caches a token, reusing it on a second call', async () => {
    const fetchToken = vi.fn(async () => ({ access_token: 'tok-1', expires_in: 3599 }));
    const first = await getAppEventsToken(app, { fetchToken });
    const second = await getAppEventsToken(app, { fetchToken });
    expect(first).toBe('tok-1');
    expect(second).toBe('tok-1');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('reports a usage event with the correct idempotency key and returns reported on 202', async () => {
    const postEvent = vi.fn(async () => ({ ok: true, status: 202 }));
    const result = await reportUsageEvent(
      app,
      { shopifyShopId: 12345, jobId: '11111111-1111-1111-1111-111111111111' },
      { getToken: async () => 'tok-x', postEvent },
    );
    expect(result).toBe('reported');
    expect(postEvent).toHaveBeenCalledWith(
      'tok-x',
      expect.objectContaining({
        shop_id: 'gid://shopify/Shop/12345',
        event_handle: 'tryon_generated',
        idempotency_key: 'usage:11111111-1111-1111-1111-111111111111',
      }),
    );
  });

  it('returns failed when the POST does not succeed', async () => {
    const postEvent = vi.fn(async () => ({ ok: false, status: 500 }));
    const result = await reportUsageEvent(
      app,
      { shopifyShopId: 12345, jobId: '22222222-2222-2222-2222-222222222222' },
      { getToken: async () => 'tok-x', postEvent },
    );
    expect(result).toBe('failed');
  });
});
