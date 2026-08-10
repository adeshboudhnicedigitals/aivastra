import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getShopifyTrialCredits } from '../src/lib/resolution-config.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('getShopifyTrialCredits', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  afterEach(async () => {
    await app.redis.del(CONFIG_KEY);
  });

  it('falls back to the default (25) when nothing is stored', async () => {
    expect(await getShopifyTrialCredits(app)).toBe(25);
  });

  it('reads the admin-configured value', async () => {
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopify: { trialCredits: 40 } }));
    expect(await getShopifyTrialCredits(app)).toBe(40);
  });

  it('falls back to the default when the stored value is malformed', async () => {
    await app.redis.set(CONFIG_KEY, 'not json');
    expect(await getShopifyTrialCredits(app)).toBe(25);
  });

  it('falls back to the default when shopify.trialCredits is not a number', async () => {
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopify: { trialCredits: 'lots' } }));
    expect(await getShopifyTrialCredits(app)).toBe(25);
  });
});
