import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { appUpdatePromptRoutes } from '../src/modules/app-update/update-prompt.routes.js';

// Drives the real route with a stubbed Redis (no containers). The admin-config round trip
// is covered by test/integration/app-update-prompt.test.ts.
async function build(stored: unknown) {
  const app = Fastify();
  app.decorate('redis', {
    get: async () => (stored === undefined ? null : JSON.stringify(stored)),
  });
  await app.register(appUpdatePromptRoutes);
  return app;
}

const androidUpdate = {
  enabled: true,
  latestVersionCode: 25,
  title: 'Update available',
  message: 'A new version is ready.',
  ctaLabel: 'Update now',
};

describe('GET /v1/app/update-prompt', () => {
  let app: Awaited<ReturnType<typeof build>> | undefined;
  afterEach(async () => {
    await app?.close();
  });
  const ask = async (stored: unknown, qs: string) => {
    app = await build(stored);
    return (await app.inject({ method: 'GET', url: `/v1/app/update-prompt${qs}` })).json();
  };

  it('is hidden when nothing is configured', async () => {
    expect(await ask(undefined, '?versionCode=1')).toEqual({ show: false });
    expect(await ask({}, '?versionCode=1')).toEqual({ show: false });
  });

  it('shows the configured copy to an older build', async () => {
    expect(await ask({ androidUpdate }, '?versionCode=24')).toEqual({
      show: true,
      latestVersionCode: 25,
      title: 'Update available',
      message: 'A new version is ready.',
      ctaLabel: 'Update now',
    });
  });

  it('hides at or above latestVersionCode', async () => {
    expect(await ask({ androidUpdate }, '?versionCode=25')).toEqual({ show: false });
    expect(await ask({ androidUpdate }, '?versionCode=26')).toEqual({ show: false });
  });

  it('hides when disabled', async () => {
    expect(
      await ask({ androidUpdate: { ...androidUpdate, enabled: false } }, '?versionCode=1'),
    ).toEqual({
      show: false,
    });
  });

  it('hides on a missing, non-numeric, negative or fractional versionCode', async () => {
    for (const qs of ['', '?versionCode=abc', '?versionCode=-3', '?versionCode=2.5']) {
      expect(await ask({ androidUpdate }, qs)).toEqual({ show: false });
    }
  });

  it('fills missing copy fields from defaults', async () => {
    const out = await ask(
      { androidUpdate: { enabled: true, latestVersionCode: 9 } },
      '?versionCode=1',
    );
    expect(out).toMatchObject({ show: true, latestVersionCode: 9, ctaLabel: 'Update now' });
  });
});
