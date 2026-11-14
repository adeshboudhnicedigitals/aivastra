import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /v1/app/update-prompt (Android update popup)', () => {
  let c: Containers;
  let app: TestApp;
  let admin: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    admin = await adminAuthHeader(app);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  beforeEach(async () => {
    await app.redis.del('config:system');
  });

  const base = {
    enabled: true,
    latestVersionCode: 25,
    title: 'Update available',
    message: 'A new version is ready.',
    ctaLabel: 'Update now',
  };
  const setUpdate = (androidUpdate: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: '/admin/config',
      headers: admin,
      payload: { androidUpdate },
    });
  const ask = (versionCode: string | number | undefined) =>
    app.inject({
      method: 'GET',
      url: `/v1/app/update-prompt${versionCode === undefined ? '' : `?versionCode=${versionCode}`}`,
    });

  it('is off by default, and needs no login', async () => {
    const res = await ask(1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ show: false });
  });

  it('shows the configured copy to a build older than latestVersionCode', async () => {
    expect((await setUpdate(base)).statusCode).toBe(200);
    const res = await ask(24);
    expect(res.json()).toEqual({
      show: true,
      latestVersionCode: 25,
      title: base.title,
      message: base.message,
      ctaLabel: base.ctaLabel,
    });
  });

  it('hides once the installed build reaches or passes latestVersionCode', async () => {
    await setUpdate(base);
    expect((await ask(25)).json()).toEqual({ show: false });
    expect((await ask(26)).json()).toEqual({ show: false });
  });

  it('stays hidden when disabled even for an old build', async () => {
    await setUpdate({ ...base, enabled: false });
    expect((await ask(1)).json()).toEqual({ show: false });
  });

  it('says nothing when versionCode is missing or not a number', async () => {
    await setUpdate(base);
    expect((await ask(undefined)).json()).toEqual({ show: false });
    expect((await ask('abc')).json()).toEqual({ show: false });
    expect((await ask(-3)).json()).toEqual({ show: false });
  });

  it('GET /admin/config returns defaults, then the saved values', async () => {
    const before = await app.inject({ method: 'GET', url: '/admin/config', headers: admin });
    expect(before.json().androidUpdate).toMatchObject({ enabled: false, latestVersionCode: 0 });
    await setUpdate(base);
    const after = await app.inject({ method: 'GET', url: '/admin/config', headers: admin });
    expect(after.json().androidUpdate).toEqual(base);
  });

  it('rejects an invalid config (negative or fractional versionCode, empty copy)', async () => {
    expect((await setUpdate({ ...base, latestVersionCode: -1 })).statusCode).toBe(400);
    expect((await setUpdate({ ...base, latestVersionCode: 2.5 })).statusCode).toBe(400);
    expect((await setUpdate({ ...base, message: '' })).statusCode).toBe(400);
  });
});
