import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

// 2.3: merchants previously had no way to see their own job volume, success
// rate, credit spend, or a gallery of recent generated outputs without asking
// support. /v1/merchant/analytics aggregates across every job source
// (catalogue-manager, kiosk, developer API) — unlike /v1/merchant/api-usage,
// which is scoped to API-key-attributed jobs only.
describe('GET /v1/merchant/analytics', () => {
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

  async function createMerchant(email: string) {
    const [merchantUser] = await app.db
      .insert(schema.users)
      .values({ email, passwordHash: 'unused' })
      .returning();
    const [merchant] = await app.db
      .insert(schema.merchants)
      .values({
        companyName: 'Merchant Co',
        contactName: 'Merchant Owner',
        phone: '9999999999',
        businessAddress: 'Test Street',
        isActive: true,
        userId: merchantUser.id,
      })
      .returning();
    return { merchant, merchantUser };
  }

  async function authHeader(userId: string) {
    const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
    return { authorization: `Bearer ${token}` };
  }

  async function seedJob(
    merchantId: string,
    status: string,
    opts?: { creditsCharged?: number; withOutput?: boolean },
  ) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        merchantId,
        status,
        creditsCharged: opts?.creditsCharged ?? 1,
        source: 'merchant_tryon',
      } as typeof schema.jobs.$inferInsert)
      .returning();
    if (opts?.withOutput) {
      const resultKey = `outputs/${job.id}/result.webp`;
      await app.storage.putObject(resultKey, Buffer.from('stub'), 'image/webp');
      await app.db.insert(schema.jobOutputs).values({ jobId: job.id, resultKey });
    }
    return job.id as string;
  }

  it('rejects a non-merchant user', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: 'plain-user@x.com', passwordHash: 'unused' })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(user.id),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns zeroed stats and no outputs for a merchant with no jobs', async () => {
    const { merchantUser } = await createMerchant('empty-merchant@x.com');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(merchantUser.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      successRate: null,
      totalCreditsCharged: 0,
      recentOutputs: [],
    });
  });

  it('aggregates totals, success rate, and credit spend across all job sources for the merchant', async () => {
    const { merchant, merchantUser } = await createMerchant('active-merchant@x.com');
    await seedJob(merchant.id, 'COMPLETED', { creditsCharged: 2, withOutput: true });
    await seedJob(merchant.id, 'COMPLETED', { creditsCharged: 3, withOutput: true });
    await seedJob(merchant.id, 'FAILED', { creditsCharged: 1 });
    await seedJob(merchant.id, 'QUEUED', { creditsCharged: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(merchantUser.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalJobs).toBe(4);
    expect(body.completedJobs).toBe(2);
    expect(body.failedJobs).toBe(1);
    expect(body.successRate).toBeCloseTo(2 / 3); // 2 completed / 3 terminal (queued excluded)
    expect(body.totalCreditsCharged).toBe(7); // 2+3+1+1 across every status, not just terminal
    expect(body.recentOutputs).toHaveLength(2);
    for (const o of body.recentOutputs) {
      expect(o.thumbnailUrl).toContain('X-Amz-Signature');
    }
  });

  it("never returns another merchant's jobs or outputs", async () => {
    const { merchant: merchantA, merchantUser: userA } = await createMerchant('merchant-a@x.com');
    const { merchant: merchantB } = await createMerchant('merchant-b@x.com');
    await seedJob(merchantA.id, 'COMPLETED', { withOutput: true });
    await seedJob(merchantB.id, 'COMPLETED', { withOutput: true });
    await seedJob(merchantB.id, 'COMPLETED', { withOutput: true });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(userA.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalJobs).toBe(1);
    expect(body.recentOutputs).toHaveLength(1);
  });

  it('a job with no completed output is excluded from recentOutputs even if COMPLETED', async () => {
    const { merchant, merchantUser } = await createMerchant('no-output-merchant@x.com');
    await seedJob(merchant.id, 'COMPLETED'); // no job_outputs row at all
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/analytics',
      headers: await authHeader(merchantUser.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recentOutputs).toEqual([]);
  });
});
