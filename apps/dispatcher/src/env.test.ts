import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from './env.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
  R2_ENDPOINT: 'http://127.0.0.1:9000',
  R2_ACCESS_KEY_ID: 'k',
  R2_SECRET_ACCESS_KEY: 's',
  R2_BUCKET: 'b',
  R2_PUBLIC_URL: 'http://127.0.0.1:9000/b',
};

function stub(extra: Record<string, string> = {}) {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries({ ...REQUIRED, ...extra })) vi.stubEnv(k, v);
}

describe('DISPATCHER_MODE', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the full dispatcher, so existing deployments are unchanged', () => {
    stub();
    delete process.env.DISPATCHER_MODE; // an ambient value must not leak into the default
    expect(loadEnv().DISPATCHER_MODE).toBe('full');
  });

  it('accepts monitor', () => {
    stub({ DISPATCHER_MODE: 'monitor' });
    expect(loadEnv().DISPATCHER_MODE).toBe('monitor');
  });

  it('rejects an unrecognised value instead of silently running full', () => {
    stub({ DISPATCHER_MODE: 'monitoring' });
    expect(() => loadEnv()).toThrow();
  });
});
