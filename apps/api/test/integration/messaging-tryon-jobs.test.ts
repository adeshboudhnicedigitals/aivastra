import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { createTryonRun, listPoolPoses } from '../../src/modules/messaging/tryon-jobs';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

describe('whatsapp try-on pool and run creation', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];
  let tryonWf: { id: string };
  let seq = 0;
  const WORKER_ID = 'tryon-worker-test';

  const seedWorker = async () => {
    await app.redis.hset(
      'worker:registry',
      WORKER_ID,
      JSON.stringify({
        url: 'http://worker.test',
        apiKey: 'test-key',
        status: 'IDLE',
        lastSeen: Date.now(),
        allowedJobTypes: [],
      }),
    );
    await app.redis.setex(`worker:health:${WORKER_ID}`, 300, '1');
  };

  // The bot runs one admin-picked workflow for every pose (config:system.whatsappTryon).
  const useWorkflow = (id: string | null) =>
    app.redis.set('config:system', JSON.stringify({ whatsappTryon: { workflowTemplateId: id } }));

  const pose = async (over: Partial<typeof schema.modelPoseAssets.$inferInsert> = {}) => {
    const n = ++seq;
    const [p] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `TryonPose${Date.now()}-${n}`,
        genderSlug: 'men',
        shotType: 'full',
        r2Key: `tp-${Date.now()}-${n}.jpg`,
        thumbnailKey: `tp-${Date.now()}-${n}.thumb.jpg`,
        workflowTemplateId: tryonWf.id,
        whatsappPool: true,
        ...over,
      })
      .returning();
    return p;
  };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
    });
    realHeadObject = app.storage.headObject.bind(app.storage);
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    [tryonWf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `tryon-wf-${Date.now()}`,
        label: 'Tryon wf',
        jsonContent: {},
        workflowType: 'tryon',
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    await useWorkflow(tryonWf.id);
  }, 60000);
  beforeEach(async () => {
    await seedWorker();
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    app.storage.headObject = realHeadObject;
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('listPoolPoses returns only eligible poses for the gender', async () => {
    const ok = await pose({ genderSlug: 'boys', shotType: 'half' });
    await pose({ genderSlug: 'boys', whatsappPool: false });
    await pose({ genderSlug: 'boys', isActive: false });
    await pose({ genderSlug: 'boys', deletedAt: new Date() });
    await pose({ genderSlug: 'boys', shotType: 'closeup' });
    await pose({ genderSlug: 'girls' });

    const found = await listPoolPoses(app, 'boys');
    expect(found.map((p) => p.id)).toEqual([ok.id]);
    expect(found[0]).toMatchObject({
      gender: 'boys',
      shotType: 'half',
      r2Key: ok.r2Key,
      workflowTemplateId: tryonWf.id,
    });
  });

  it('listPoolPoses offers nothing unless the configured workflow is an active try-on', async () => {
    await pose({ genderSlug: 'girls' });
    const mk = async (over: Partial<typeof schema.workflowTemplates.$inferInsert>) =>
      (
        await app.db
          .insert(schema.workflowTemplates)
          .values({
            slug: `wf-${Date.now()}-${++seq}`,
            label: 'x',
            jsonContent: {},
            poseNodeId: '1',
            upperNodeIds: [],
            garmentPhasePromptNode: '2',
            ...over,
          })
          .returning()
      )[0];
    const inactive = await mk({ workflowType: 'tryon', isActive: false });
    const regular = await mk({});
    try {
      for (const id of [null, inactive.id, regular.id]) {
        await useWorkflow(id);
        expect(await listPoolPoses(app, 'girls')).toEqual([]);
      }
    } finally {
      await useWorkflow(tryonWf.id);
    }
    expect((await listPoolPoses(app, 'girls')).length).toBeGreaterThan(0);
  });

  async function seller(credits: number) {
    const { userId } = await createVerifiedUserToken(
      app,
      `tryon-${Date.now()}-${++seq}@example.com`,
    );
    await app.db.insert(schema.userCredits).values({ userId, balance: credits });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-9)}${seq}`,
      userId,
      linkedVia: 'web_code',
    });
    const garmentKey = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    return { userId, accountId: account.id, garmentKey };
  }
  const balanceOf = async (userId: string) =>
    (
      await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0]?.balance;

  it('creates one charged job per pose, sharing one run id, and records the run', async () => {
    const s = await seller(100);
    const poses = [
      await pose({ genderSlug: 'men' }),
      await pose({ genderSlug: 'men', shotType: 'half' }),
    ];
    const tp = (await listPoolPoses(app, 'men')).filter((p) => poses.some((x) => x.id === p.id));

    const run = await createTryonRun(
      app,
      { userId: s.userId, accountId: s.accountId, messageId: `wamid.${seq}` },
      { garmentKey: s.garmentKey, poses: tp },
    );
    expect(run).toMatchObject({ requested: 2, created: 2 });

    const [record] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, run.runId));
    expect(record).toMatchObject({ messagingAccountId: s.accountId, userId: s.userId });
    expect(record.jobIds).toHaveLength(2);

    const jobs = await app.db
      .select({
        source: schema.jobs.source,
        catalogueId: schema.jobs.catalogueId,
        upperGarmentKey: schema.jobInputs.upperGarmentKey,
        params: schema.jobInputs.params,
      })
      .from(schema.jobs)
      .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .where(eq(schema.jobs.catalogueId, run.runId));
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.source).toBe('whatsapp_tryon');
      expect(j.upperGarmentKey).toBe(s.garmentKey);
      expect(j.params).toMatchObject({ workflowTemplateId: tryonWf.id });
    }
    expect(jobs.map((j) => (j.params as { personKey: string }).personKey).sort()).toEqual(
      poses.map((p) => p.r2Key).sort(),
    );
    expect(await balanceOf(s.userId)).toBe(90); // 2 × 5
  });

  it('a redelivered message does not create a second run', async () => {
    const s = await seller(100);
    const [p] = await listPoolPoses(app, 'men');
    const ctx = { userId: s.userId, accountId: s.accountId, messageId: `wamid.dup.${seq}` };
    const a = await createTryonRun(app, ctx, { garmentKey: s.garmentKey, poses: [p] });
    const b = await createTryonRun(app, ctx, { garmentKey: s.garmentKey, poses: [p] });
    expect(b.runId).toBe(a.runId);
    expect(await balanceOf(s.userId)).toBe(95);
  });

  it('refuses to charge when no try-on worker is registered', async () => {
    const s = await seller(100);
    const [p] = await listPoolPoses(app, 'men');
    await app.redis.del('worker:registry');

    await expect(
      createTryonRun(
        app,
        { userId: s.userId, accountId: s.accountId, messageId: `wamid.noworker.${seq}` },
        { garmentKey: s.garmentKey, poses: [p] },
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });

    expect(await balanceOf(s.userId)).toBe(100);
    const runs = await app.db
      .select({ catalogueId: schema.messagingRuns.catalogueId })
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.messagingAccountId, s.accountId));
    expect(runs).toHaveLength(0);
    const jobs = await app.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.userId, s.userId));
    expect(jobs).toHaveLength(0);
  });

  it('a run the balance cannot cover entirely throws INSUFFICIENT_CREDITS and charges nothing', async () => {
    const s = await seller(3);
    const [p] = await listPoolPoses(app, 'men');
    await expect(
      createTryonRun(
        app,
        { userId: s.userId, accountId: s.accountId, messageId: `wamid.poor.${seq}` },
        { garmentKey: s.garmentKey, poses: [p] },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(await balanceOf(s.userId)).toBe(3);
  });

  it('a balance that covers only some poses creates those and reports the rest', async () => {
    const s = await seller(7); // one image at 5 credits
    const all = await listPoolPoses(app, 'men');
    const run = await createTryonRun(
      app,
      { userId: s.userId, accountId: s.accountId, messageId: `wamid.part.${seq}` },
      { garmentKey: s.garmentKey, poses: all.slice(0, 2) },
    );
    expect(run).toMatchObject({ requested: 2, created: 1 });
    expect(run.reason).toBeTruthy();
    expect(await balanceOf(s.userId)).toBe(2);
  });

  it('refuses a garment key the user does not own', async () => {
    const s = await seller(100);
    const other = await seller(100);
    const [p] = await listPoolPoses(app, 'men');
    await expect(
      createTryonRun(
        app,
        { userId: s.userId, accountId: s.accountId, messageId: `wamid.own.${seq}` },
        { garmentKey: other.garmentKey, poses: [p] },
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await balanceOf(s.userId)).toBe(100);
  });
});
