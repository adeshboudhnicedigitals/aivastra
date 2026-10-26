import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runShopifyRetention } from '../../src/shopify/retention.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const DAY = 86_400_000;
const log = createLogger('test');

describe('shopify retention — widget events', () => {
  let env: TestEnv;
  let storeId: string;

  beforeAll(async () => {
    env = await setupTestEnv();
    const [store] = await env.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `ret-${randomUUID()}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1e9),
        accessToken: 'x',
        scope: 'read_products',
        settings: {},
      })
      .returning();
    storeId = store.id;
  }, 60_000);

  afterAll(async () => {
    await env.cleanup();
  });

  it('deletes events past 400 days and keeps everything newer', async () => {
    await env.db.insert(schema.shopifyWidgetEvents).values([
      { storeId, type: 'button_click', createdAt: new Date(Date.now() - 401 * DAY) },
      { storeId, type: 'button_click', createdAt: new Date(Date.now() - 399 * DAY) },
      { storeId, type: 'add_to_cart', createdAt: new Date() },
    ]);

    await runShopifyRetention(env.db, env.storage, log, env.withAdvisoryLock);

    const rows = await env.db
      .select()
      .from(schema.shopifyWidgetEvents)
      .where(eq(schema.shopifyWidgetEvents.storeId, storeId));

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => Date.now() - r.createdAt.getTime() < 400 * DAY)).toBe(true);
  });

  it('sweeps events even for a store with no retention settings configured', async () => {
    // The 400-day events horizon is fixed, not merchant-configurable — the
    // other three passes bail on `if (!retention) continue`, and this pass must
    // not be trapped behind that guard.
    const rows = await env.db
      .select()
      .from(schema.shopifyWidgetEvents)
      .where(eq(schema.shopifyWidgetEvents.storeId, storeId));
    expect(rows).toHaveLength(2);
  });

  it('drains a backlog larger than one BATCH in a single call', async () => {
    // BATCH is 500 (see retention.ts) — a single select+delete pass cannot
    // clear this many rows. This proves the sweep loops until fully drained
    // rather than leaving a remainder for the next hourly run.
    const OVER_ONE_BATCH = 650;
    const values = Array.from({ length: OVER_ONE_BATCH }, () => ({
      storeId,
      type: 'button_click',
      createdAt: new Date(Date.now() - 401 * DAY),
    }));
    await env.db.insert(schema.shopifyWidgetEvents).values(values);

    await runShopifyRetention(env.db, env.storage, log, env.withAdvisoryLock);

    const rows = await env.db
      .select()
      .from(schema.shopifyWidgetEvents)
      .where(eq(schema.shopifyWidgetEvents.storeId, storeId));

    // Only the two rows already newer than 400 days (seeded in the first
    // test) should remain — the entire backlog is gone in one call.
    expect(rows).toHaveLength(2);
  });

  it('erases a comparison replay before Shopify photo retention clears its source pointer', async () => {
    const [store] = await env.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `ret-compare-${randomUUID()}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1e9),
        accessToken: 'x',
        scope: 'read_products',
        settings: { retention: { shopperPhotoDays: 1 } },
      })
      .returning();
    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `ret-compare-${randomUUID()}`,
        label: 'Retention comparison',
        jsonContent: {},
        workflowType: 'tryon',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    const photoKey = `shopify-inputs/${store.id}/${randomUUID()}.jpg`;
    const [source] = await env.db
      .insert(schema.jobs)
      .values({
        shopifyStoreId: store.id,
        customerPhotoKey: photoKey,
        source: 'shopify',
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 2 * DAY),
      })
      .returning();
    await env.db
      .insert(schema.jobInputs)
      .values({ jobId: source.id, params: { personKey: photoKey } });
    await env.storage.putObject(photoKey, Buffer.from('source'), 'image/jpeg');
    const [systemUser] = await env.db
      .insert(schema.users)
      .values({ email: `ret-compare-${randomUUID()}@internal.test` })
      .returning();
    const [replay] = await env.db
      .insert(schema.jobs)
      .values({
        userId: systemUser.id,
        source: 'comparison',
        status: 'COMPLETED',
        creditsCharged: 0,
      })
      .returning();
    const replayKey = keys.output(replay.id);
    await env.storage.putObject(replayKey, Buffer.from('replay'), 'image/png');
    await env.db.insert(schema.jobOutputs).values({ jobId: replay.id, resultKey: replayKey });
    const [comparison] = await env.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        generalJobId: replay.id,
        templateId: template.id,
        templateVersion: 1,
        status: 'COMPLETED',
      })
      .returning();

    await runShopifyRetention(env.db, env.storage, log, env.withAdvisoryLock);

    const [updatedSource] = await env.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, source.id));
    expect(updatedSource?.customerPhotoKey).toBeNull();
    await expect(env.storage.headObject(photoKey)).rejects.toThrow();
    await expect(env.storage.headObject(replayKey)).rejects.toThrow();
    expect(await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, replay.id))).toEqual(
      [],
    );
    expect(
      await env.db
        .select()
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, comparison.id)),
    ).toEqual([]);
  });
});
