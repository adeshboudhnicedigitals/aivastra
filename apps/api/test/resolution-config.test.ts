import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getShopifyPlanCredits, getShopifyTrialCredits } from '../src/lib/resolution-config.js';
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

describe('getShopifyPlanCredits', () => {
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

  it('falls back to the default amount for each known handle when nothing is stored', async () => {
    expect(await getShopifyPlanCredits(app, 'starter')).toBe(1925);
    expect(await getShopifyPlanCredits(app, 'growth')).toBe(5000);
    expect(await getShopifyPlanCredits(app, 'pro')).toBe(22000);
  });

  it('matches case-insensitively, same as normalizePlanName', async () => {
    expect(await getShopifyPlanCredits(app, 'Starter')).toBe(1925);
    expect(await getShopifyPlanCredits(app, '  GROWTH ')).toBe(5000);
  });

  it('returns null for an unrecognized plan name', async () => {
    expect(await getShopifyPlanCredits(app, 'enterprise')).toBeNull();
    expect(await getShopifyPlanCredits(app, '')).toBeNull();
  });

  it('reads an admin-configured override for one handle, leaving others at default', async () => {
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({ shopify: { planCredits: { starter: 3000 } } }),
    );
    expect(await getShopifyPlanCredits(app, 'starter')).toBe(3000);
    expect(await getShopifyPlanCredits(app, 'growth')).toBe(5000);
  });

  it('falls back to the default when the stored value is malformed', async () => {
    await app.redis.set(CONFIG_KEY, 'not json');
    expect(await getShopifyPlanCredits(app, 'pro')).toBe(22000);
  });
});
