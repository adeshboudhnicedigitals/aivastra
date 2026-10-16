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
describe('env - WHATSAPP_GRAPH_VERSION', () => {
  it('treats a blank value as unset and falls back to the default', () => {
    // .env.example ships the line blank; that must not crash startup.
    process.env = { ...minimalEnv, WHATSAPP_GRAPH_VERSION: '' };
    expect(loadEnv().WHATSAPP_GRAPH_VERSION).toBe('v25.0');
  });

  it('defaults when the variable is absent', () => {
    process.env = { ...minimalEnv };
    expect(loadEnv().WHATSAPP_GRAPH_VERSION).toBe('v25.0');
  });

  it('keeps an explicit version', () => {
    process.env = { ...minimalEnv, WHATSAPP_GRAPH_VERSION: 'v24.0' };
    expect(loadEnv().WHATSAPP_GRAPH_VERSION).toBe('v24.0');
  });

  it('rejects a malformed version', () => {
    process.env = { ...minimalEnv, WHATSAPP_GRAPH_VERSION: '25' };
    expect(() => loadEnv()).toThrow();
  });
});
