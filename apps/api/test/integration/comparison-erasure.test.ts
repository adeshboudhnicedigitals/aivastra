import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevJobCore } from '../../src/modules/dev/create-job.js';
import { lockAndAssertUserCanCreateJobs } from '../../src/modules/jobs/creation-guard.js';
import { redactShopperData } from '../../src/modules/shopify/gdpr.js';
import { shopifyStoreLifecycleLockKey } from '../../src/modules/shopify/store-lock.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('workflow comparison source erasure', () => {
  let c: Containers;
  let app: TestApp;
  let templateId: string;
  const stored = new Set<string>();

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `erasure-${randomUUID()}`,
        label: 'Erasure fixture',
        jsonContent: {},
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    templateId = template.id;
  }, 60_000);

  afterAll(async () => {
    if (app) {
      for (const key of stored) await app.storage.deleteObject(key);
      await app.close();
    }
    await c?.stop();
  });

  async function seedLinked(opts: { collected?: boolean; userId?: string } = {}) {
    const nonce = randomUUID();
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `erase-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'iv:tag:enc',
        scope: 'read_products',
      })
      .returning();
    const [shopper] = await app.db
      .insert(schema.shopifyShoppers)
      .values({ storeId: store.id, clientId: `erase-${nonce}`, email: `erase-${nonce}@x.test` })
      .returning();
    const photoKey = `shopify-inputs/${store.id}/${nonce}.jpg`;
    const sourceResult = keys.output(`source-${nonce}`);
    const personKey = `inputs/${nonce}/person.jpg`;
    const garmentKey = `inputs/${nonce}/garment.jpg`;
    for (const key of [photoKey, sourceResult, personKey, garmentKey]) {
      await app.storage.putObject(key, Buffer.from('fixture'), 'image/png');
      stored.add(key);
    }
    // biome-ignore lint/suspicious/noExplicitAny: nullable Shopify ownership columns are inferred non-null
    const [source] = await (app.db.insert(schema.jobs).values as any)({
      userId: opts.userId,
      shopifyStoreId: store.id,
      shopifyShopperId: shopper.id,
      customerPhotoKey: photoKey,
      source: 'shopify',
      status: 'COMPLETED',
      creditsCharged: 1,
    }).returning();
    await app.db.insert(schema.jobInputs).values({ jobId: source.id, params: { personKey } });
    await app.db.insert(schema.jobOutputs).values({ jobId: source.id, resultKey: sourceResult });

    let replayId: string | null = null;
    let replayResult: string | null = null;
    if (!opts.collected) {
      const [systemUser] = await app.db
        .insert(schema.users)
        .values({ email: `system-${nonce}@internal.test`, emailVerified: true })
        .returning();
      const [replay] = await app.db
        .insert(schema.jobs)
        .values({
          userId: systemUser.id,
          source: 'comparison',
          status: 'COMPLETED',
          creditsCharged: 0,
        })
        .returning();
      replayId = replay.id;
      replayResult = keys.output(replay.id);
      await app.storage.putObject(replayResult, Buffer.from('replay'), 'image/png');
      stored.add(replayResult);
      await app.db.insert(schema.jobOutputs).values({ jobId: replay.id, resultKey: replayResult });
    }
    const [comparison] = await app.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        generalJobId: replayId,
        templateId,
        templateVersion: 1,
        personKey,
        garmentKey,
        status: opts.collected ? 'COLLECTED' : 'COMPLETED',
      })
      .returning();
    return { store, shopper, source, comparison, replayId, replayResult, photoKey };
  }

  it('erases replay output and replay job before completing Shopify shopper redaction', async () => {
    const s = await seedLinked();
    if (!s.replayId || !s.replayResult) throw new Error('expected dispatched replay fixture');

    const result = await redactShopperData(app, s.store.id, { email: s.shopper.email });

    expect(result).toEqual({ removed: 1, incomplete: 0 });
    await expect(app.storage.headObject(s.replayResult)).rejects.toThrow();
    expect(await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.replayId))).toEqual(
      [],
    );
    expect(
      await app.db
        .select()
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, s.comparison.id)),
    ).toEqual([]);
  });

  it('expires an undispatched comparison and clears its frozen image pointers', async () => {
    const s = await seedLinked({ collected: true });

    const result = await redactShopperData(app, s.store.id, { email: s.shopper.email });

    expect(result.incomplete).toBe(0);
    const [comparison] = await app.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, s.comparison.id));
    expect(comparison).toMatchObject({ status: 'EXPIRED', personKey: null, garmentKey: null });
  });

  it('retains shopper/source pointers and linked cleanup roots when replay deletion fails', async () => {
    const s = await seedLinked();
    const deleteObject = app.storage.deleteObject.bind(app.storage);
    app.storage.deleteObject = async (key: string) => {
      if (key.startsWith(`outputs/${s.replayId}/`)) throw new Error('simulated R2 outage');
      return deleteObject(key);
    };
    try {
      const result = await redactShopperData(app, s.store.id, { email: s.shopper.email });
      expect(result.incomplete).toBe(1);
    } finally {
      app.storage.deleteObject = deleteObject;
    }
    expect(
      await app.db
        .select()
        .from(schema.shopifyShoppers)
        .where(eq(schema.shopifyShoppers.id, s.shopper.id)),
    ).toHaveLength(1);
    expect(
      await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.source.id)),
    ).toHaveLength(1);
    expect(
      await app.db
        .select()
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, s.comparison.id)),
    ).toHaveLength(1);
  });

  it('erases linked replays when an admin anonymizes the source owner', async () => {
    const { token, userId: adminId } = await createVerifiedUserToken(
      app,
      `admin-${randomUUID()}@x.test`,
    );
    await app.db.insert(schema.adminUsers).values({ userId: adminId, role: 'SUPER_ADMIN' });
    const { userId } = await createVerifiedUserToken(app, `target-${randomUUID()}@x.test`);
    const s = await seedLinked({ userId });
    if (!s.replayId || !s.replayResult) throw new Error('expected dispatched replay fixture');
    const headers = { authorization: `Bearer ${token}` };

    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${userId}`, headers });

    expect(res.statusCode).toBe(200);
    await expect(app.storage.headObject(s.replayResult)).rejects.toThrow();
    expect(await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.replayId))).toEqual(
      [],
    );
  });

  it('cleans a comparison before customer deletion removes the source job', async () => {
    const { token, userId } = await createVerifiedUserToken(
      app,
      `delete-source-${randomUUID()}@x.test`,
    );
    const s = await seedLinked({ userId });
    if (!s.replayId || !s.replayResult) throw new Error('expected dispatched replay fixture');

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/jobs/${s.source.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    await expect(app.storage.headObject(s.replayResult)).rejects.toThrow();
    expect(await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.replayId))).toEqual(
      [],
    );
    expect(await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.source.id))).toEqual(
      [],
    );
  });

  it('serializes a job insert that passed its initial check against account erasure', async () => {
    const { userId } = await createVerifiedUserToken(app, `ban-race-${randomUUID()}@x.test`);
    let allowErasureCommit!: () => void;
    let lockedForErasure!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      allowErasureCommit = resolve;
    });
    const lockReady = new Promise<void>((resolve) => {
      lockedForErasure = resolve;
    });
    const ban = app.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for('update');
      await tx.update(schema.users).set({ isBanned: true }).where(eq(schema.users.id, userId));
      lockedForErasure();
      await commitGate;
    });
    await lockReady;
    const create = app.db.transaction((tx) => lockAndAssertUserCanCreateJobs(tx, userId));
    await new Promise((resolve) => setTimeout(resolve, 50));
    allowErasureCommit();
    await ban;

    await expect(create).rejects.toThrow('banned');
  });

  it('makes Shopify job insertion xact locks contend with store deletion session locks', async () => {
    const lockKey = shopifyStoreLifecycleLockKey(randomUUID());
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const insertion = app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      locked();
      await gate;
    });
    await ready;

    expect(await app.withAdvisoryLock(lockKey, async () => true)).toBeUndefined();

    release();
    await insertion;
    expect(await app.withAdvisoryLock(lockKey, async () => true)).toBe(true);
  });

  it('rejects a developer API job whose account was banned before its insert transaction', async () => {
    const { userId } = await createVerifiedUserToken(app, `dev-ban-${randomUUID()}@x.test`);
    await app.db.update(schema.users).set({ isBanned: true }).where(eq(schema.users.id, userId));

    await expect(
      createDevJobCore(app, {
        merchantUserId: userId,
        apiKeyId: null,
        cost: 0,
        watermark: false,
        source: 'api_tryon',
        buildJobInputs: () => ({ params: { personKey: 'dev/person.jpg' } }),
      }),
    ).rejects.toThrow('banned');
    expect(await app.db.select().from(schema.jobs).where(eq(schema.jobs.userId, userId))).toEqual(
      [],
    );
  });
});
