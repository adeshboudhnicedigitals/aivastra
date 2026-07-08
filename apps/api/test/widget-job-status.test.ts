import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;
let widgetKey: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  const [wc] = await app.db
    .insert(schema.widgetClients)
    .values({
      companyName: 'Result URL Test',
      contactName: 'Test',
      email: `result-url-${randomUUID()}@example.com`,
      phone: '1',
      websiteUrl: 'https://example.com',
      companySize: 'unknown',
      purpose: 'test',
      businessAddress: 'n/a',
      passwordHash: '',
      isActive: true,
    })
    .returning();
  widgetKey = wc.widgetKey;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/widget/jobs/:id resultUrl', () => {
  it('includes resultUrl when the job has a result', async () => {
    const [wc] = await app.db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.widgetKey, widgetKey));
    const jobId = randomUUID();
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId/FK cols as non-null; widget jobs legitimately have null userId
    await (app.db.insert(schema.jobs).values as any)({
      id: jobId,
      userId: null,
      widgetClientId: wc.id,
      status: 'COMPLETED',
      creditsCharged: 10,
    });
    await app.db.insert(schema.jobOutputs).values({
      jobId,
      resultKey: 'outputs/test-job/result.png',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/widget/jobs/${jobId}`,
      headers: { 'x-widget-key': widgetKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resultUrl).toBe(app.storage.publicUrl('outputs/test-job/result.png'));
  });

  it('has a null resultUrl when the job has no result yet', async () => {
    const [wc] = await app.db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.widgetKey, widgetKey));
    const jobId = randomUUID();
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId/FK cols as non-null; widget jobs legitimately have null userId
    await (app.db.insert(schema.jobs).values as any)({
      id: jobId,
      userId: null,
      widgetClientId: wc.id,
      status: 'QUEUED',
      creditsCharged: 10,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/widget/jobs/${jobId}`,
      headers: { 'x-widget-key': widgetKey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resultUrl).toBeNull();
  });
});
