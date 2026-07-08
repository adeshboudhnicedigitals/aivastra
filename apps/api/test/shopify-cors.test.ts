import { randomUUID } from 'node:crypto';

import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
});
