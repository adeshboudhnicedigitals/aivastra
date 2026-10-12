import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRefundTx } from '../../src/modules/credits/ledger.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('applyRefundTx', () => {
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

  async function seed() {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `apply-tx-${Date.now()}@x.com`, emailVerified: true })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 5 });
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    return { userId: user.id, jobId: job.id };
  }

  async function balance(userId: string) {
    const [row] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    return row.balance;
  }

  it('credits once and is a no-op on replay for the same (job, reason)', async () => {
    const { userId, jobId } = await seed();
    const first = await app.db.transaction((tx) =>
      applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST'),
    );
    const second = await app.db.transaction((tx) =>
      applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST'),
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await balance(userId)).toBe(15);
    const rows = await app.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('REFUND_USER_REQUEST');
    expect(rows[0].delta).toBe(10);
  });

  it('rolls the credit back when the surrounding transaction fails', async () => {
    const { userId, jobId } = await seed();
    await expect(
      app.db.transaction(async (tx) => {
        await applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await balance(userId)).toBe(5);
  });
});
