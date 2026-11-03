import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryFields, NO_MESSAGE_ID } from '../../src/stream/delivery.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { seedPaidJob } from '../helpers/paid-jobs.js';

// What the API writes to the stream today, per source (type is not reproduced: the dispatcher
// never reads it):
//   studio, saree, batch, regenerate, video  jobId, userId
//   merchant try-on (merchant/create-tryon-job.ts, create-job.ts)  jobId, userId = merchant's user, type
//   Shopify widget (shopify/customer.routes.ts)  jobId, type, no userId
describe('the message rebuilt for a delivery with no stream message', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupTestEnv();
  }, 60_000);
  afterAll(() => env?.cleanup());

  it('a delivery that has a real message id rebuilds nothing', async () => {
    const { job } = await seedPaidJob(env, 'regular');
    expect(await deliveryFields(env.db, job.id, '1-0')).toBeUndefined();
  });

  it('user job: jobId and userId', async () => {
    const { job, user } = await seedPaidJob(env, 'regular');
    expect(await deliveryFields(env.db, job.id, NO_MESSAGE_ID)).toEqual({
      jobId: job.id,
      userId: user.id,
    });
  });

  it("merchant try-on: userId is the merchant's user, whether or not the row stores it", async () => {
    const stored = await seedPaidJob(env, 'merchant_widget', { merchantUserOnJob: true });
    expect(await deliveryFields(env.db, stored.job.id, NO_MESSAGE_ID)).toEqual({
      jobId: stored.job.id,
      userId: stored.user.id,
    });
    const legacy = await seedPaidJob(env, 'merchant_widget');
    expect(
      (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, legacy.job.id)))[0]?.userId,
    ).toBeNull();
    expect(await deliveryFields(env.db, legacy.job.id, NO_MESSAGE_ID)).toEqual({
      jobId: legacy.job.id,
      userId: legacy.user.id,
    });
  });

  it('Shopify widget: jobId only, no userId', async () => {
    const { job } = await seedPaidJob(env, 'shopify');
    expect(await deliveryFields(env.db, job.id, NO_MESSAGE_ID)).toEqual({ jobId: job.id });
  });
});
