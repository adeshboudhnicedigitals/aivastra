import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

// Minimal valid env for loadEnv to parse successfully
const minimalEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
  JWT_SECRET: '00000000000000000000000000000001',
  JWT_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '1h',
  R2_ENDPOINT: 'http://localhost:9000',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'test',
  R2_PUBLIC_URL: 'http://localhost:9000/test',
  R2_FORCE_PATH_STYLE: 'true',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@example.com',
  ADMIN_BOOTSTRAP_PASSWORD: 'password123',
  CORS_ORIGIN: 'http://localhost:3000',
  COOKIE_SECRET: '00000000000000000000000000000002',
  WEB_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'test@example.com',
};

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('env - grant-then-verify flags', () => {
  it('defaults the flag off and the window to 180 minutes', () => {
    process.env = { ...minimalEnv };
    const env = loadEnv();
    expect(env.SHOPIFY_VERIFY_PAYMENTS).toBe(false);
    expect(env.SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(180);
  });

  it('turns the flag on only for the literal string true', () => {
    process.env = { ...minimalEnv, SHOPIFY_VERIFY_PAYMENTS: 'true' };
    expect(loadEnv().SHOPIFY_VERIFY_PAYMENTS).toBe(true);
    for (const v of ['false', '1', 'TRUE', 'yes', '']) {
      process.env = { ...minimalEnv, SHOPIFY_VERIFY_PAYMENTS: v };
      expect(loadEnv().SHOPIFY_VERIFY_PAYMENTS).toBe(false);
    }
  });

  it('treats a blank window as the default and accepts 60 or more', () => {
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(180);
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '240' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(240);
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '60' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(60);
  });

  it('rejects a window below 60 minutes or a non-number', () => {
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '30' };
    expect(() => loadEnv()).toThrow();
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 'abc' };
    expect(() => loadEnv()).toThrow();
  });
});
