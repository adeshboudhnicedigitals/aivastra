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
  // Save the original env
  process.env = { ...originalEnv };
});

afterEach(() => {
  // Restore the original env
  process.env = originalEnv;
});

describe('env - Shopify Partner blank vars', () => {
  it('parses blank SHOPIFY_PARTNER_API_TOKEN and SHOPIFY_PARTNER_ORG_ID as undefined', () => {
    process.env = {
      ...minimalEnv,
      SHOPIFY_PARTNER_API_TOKEN: '',
      SHOPIFY_PARTNER_ORG_ID: '',
    };

    const env = loadEnv();
    expect(env.SHOPIFY_PARTNER_API_TOKEN).toBeUndefined();
    expect(env.SHOPIFY_PARTNER_ORG_ID).toBeUndefined();
  });

  it('rejects SHOPIFY_PARTNER_ORG_ID with non-numeric value', () => {
    process.env = {
      ...minimalEnv,
      SHOPIFY_PARTNER_ORG_ID: 'abc',
    };

    expect(() => loadEnv()).toThrow();
  });

  it('accepts valid SHOPIFY_PARTNER_API_TOKEN and SHOPIFY_PARTNER_ORG_ID', () => {
    process.env = {
      ...minimalEnv,
      SHOPIFY_PARTNER_API_TOKEN: 'shpat_1234567890abcdef',
      SHOPIFY_PARTNER_ORG_ID: '1234567',
    };

    const env = loadEnv();
    expect(env.SHOPIFY_PARTNER_API_TOKEN).toBe('shpat_1234567890abcdef');
    expect(env.SHOPIFY_PARTNER_ORG_ID).toBe('1234567');
  });
});
