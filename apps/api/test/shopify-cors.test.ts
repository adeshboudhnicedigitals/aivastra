import { randomUUID } from 'node:crypto';

import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.db.insert(schema.widgetClients).values({
    companyName: 'CORS Test Co',
    contactName: 'Test',
    email: `cors-test-${randomUUID()}@example.com`,
    phone: '1',
    websiteUrl: 'https://allowed.example.com',
    companySize: 'unknown',
    purpose: 'test',
    businessAddress: 'n/a',
    passwordHash: '',
    isActive: true,
    allowedOrigins: ['https://allowed.example.com'],
  });
  await app.db.insert(schema.widgetClients).values({
    companyName: 'Inactive Co',
    contactName: 'Test',
    email: `inactive-test-${randomUUID()}@example.com`,
    phone: '1',
    websiteUrl: 'https://inactive.example.com',
    companySize: 'unknown',
    purpose: 'test',
    businessAddress: 'n/a',
    passwordHash: '',
    isActive: false,
    allowedOrigins: ['https://inactive.example.com'],
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('dynamic CORS', () => {
  it('reflects the static app origin (existing behavior unchanged)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('reflects an origin listed in some widgetClients.allowedOrigins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://allowed.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
  });

  it('does not allow an origin nobody has registered', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://not-registered.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not allow an origin from an inactive widget client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://inactive.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  describe('origin lookup caching', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('serves a cached allow decision for 30s after a widget client is deactivated, then re-queries after the TTL expires', async () => {
      const origin = `https://cache-test-${randomUUID()}.example.com`;
      await app.db.insert(schema.widgetClients).values({
        companyName: 'Cache Test Co',
        contactName: 'Test',
        email: `cache-test-${randomUUID()}@example.com`,
        phone: '1',
        websiteUrl: origin,
        companySize: 'unknown',
        purpose: 'test',
        businessAddress: 'n/a',
        passwordHash: '',
        isActive: true,
        allowedOrigins: [origin],
      });

      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);

      // First call: DB says active -> allowed, gets cached.
      const first = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin },
      });
      expect(first.headers['access-control-allow-origin']).toBe(origin);

      // Deactivate directly in the DB, bypassing any cache invalidation (there is none by design).
      await app.db
        .update(schema.widgetClients)
        .set({ isActive: false })
        .where(eq(schema.widgetClients.websiteUrl, origin));

      // Still within the 30s TTL: must still reflect the stale cached "allowed" answer.
      nowSpy.mockReturnValue(1_000_000 + 29_000);
      const second = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin },
      });
      expect(second.headers['access-control-allow-origin']).toBe(origin);

      // Past the TTL: cache entry expired, fresh DB lookup sees the deactivated row -> disallowed.
      nowSpy.mockReturnValue(1_000_000 + 30_001);
      const third = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin },
      });
      expect(third.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('serves a cached deny decision for an unregistered origin without a fresh DB hit each time', async () => {
      const origin = `https://never-registered-${randomUUID()}.example.com`;
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValue(2_000_000);

      const first = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(first.headers['access-control-allow-origin']).toBeUndefined();

      // Now register it as an active widget client, but stay within the TTL window: the
      // cached negative result should still win until the TTL expires.
      await app.db.insert(schema.widgetClients).values({
        companyName: 'Late Register Co',
        contactName: 'Test',
        email: `late-register-${randomUUID()}@example.com`,
        phone: '1',
        websiteUrl: origin,
        companySize: 'unknown',
        purpose: 'test',
        businessAddress: 'n/a',
        passwordHash: '',
        isActive: true,
        allowedOrigins: [origin],
      });

      nowSpy.mockReturnValue(2_000_000 + 29_000);
      const second = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(second.headers['access-control-allow-origin']).toBeUndefined();

      nowSpy.mockReturnValue(2_000_000 + 30_001);
      const third = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(third.headers['access-control-allow-origin']).toBe(origin);
    });
  });
});
