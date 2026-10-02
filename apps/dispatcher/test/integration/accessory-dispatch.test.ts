import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-accessory-dispatch';
const FACE_NODE_ID = 'f';
const POSE_NODE_ID = 'p';
const BG_NODE_ID = 'b';
const UPPER_NODE_ID = 'g';
const ACCESSORY_NODE_ID = 'acc';

// Covers Task 5 of docs/superpowers/sdd (accessory-images plan): the dispatcher's
// live resolution, stacking and patching of admin-curated accessory catalog items
// selected by the user in the studio wizard. This exercises the main `processJob`
// tryon path (face + pose + background + optional lower/shoe/accessories), not the
// merchant/shopify widget path — accessories are never wired into widget jobs.
describe('dispatcher — accessory image resolve, stack, and dispatch', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    comfy.setOptions({});
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  /**
   * Seeds a full regular tryon job (face + pose + background + upper garment,
   * the shape that reaches the accessory-resolution block in processJob) plus
   * two accessory catalog items in distinct categories with distinct
   * sortOrder, each backed by a real PNG in the test MinIO bucket (required —
   * stackAccessoryImages reads real image dimensions via sharp).
   */
  async function seedAccessoryJob(opts: { accessoryNodeMapped?: boolean } = {}) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `accessory-${stamp}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    if (!user) throw new Error('failed to seed user');
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 5 });

    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `acc-type-${stamp}`, label: 'Accessories' })
      .returning();
    if (!ct) throw new Error('failed to seed catalog type');

    // Deliberately seeded with sortOrder REVERSED relative to insertion order —
    // the category whose item is selected second below (necklace) has the
    // LOWER sortOrder, so it must end up FIRST (on top) in the stacked
    // composite. This is what distinguishes "sorted by category" from the
    // (wrong) "sorted by selection order" behavior.
    const [beltCategory] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct.id, slug: `belt-${stamp}`, label: 'Belt', sortOrder: 2 })
      .returning();
    const [necklaceCategory] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct.id, slug: `necklace-${stamp}`, label: 'Necklace', sortOrder: 1 })
      .returning();
    if (!beltCategory || !necklaceCategory) throw new Error('failed to seed catalog categories');

    const beltPng = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png()
      .toBuffer();
    const necklacePng = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 50, g: 50, b: 200 } },
    })
      .png()
      .toBuffer();

    const beltKey = `catalog/accessory/${stamp}/belt.png`;
    const necklaceKey = `catalog/accessory/${stamp}/necklace.png`;

    const [beltItem] = await env.db
      .insert(schema.catalogItems)
      .values({
        categoryId: beltCategory.id,
        type: 'accessory',
        label: 'Belt',
        r2Key: beltKey,
        thumbnailKey: beltKey,
      })
      .returning();
    const [necklaceItem] = await env.db
      .insert(schema.catalogItems)
      .values({
        categoryId: necklaceCategory.id,
        type: 'accessory',
        label: 'Necklace',
        r2Key: necklaceKey,
        thumbnailKey: necklaceKey,
      })
      .returning();
    if (!beltItem || !necklaceItem) throw new Error('failed to seed catalog items');

    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: beltKey,
        Body: beltPng,
        ContentType: 'image/png',
      }),
    );
    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: necklaceKey,
        Body: necklacePng,
        ContentType: 'image/png',
      }),
    );

    const [workflow] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `acc-wf-${stamp}`,
        label: 'Accessory dispatch test workflow',
        jsonContent: {
          [FACE_NODE_ID]: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          [POSE_NODE_ID]: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          [BG_NODE_ID]: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          [UPPER_NODE_ID]: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          [ACCESSORY_NODE_ID]: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          out: { class_type: 'SaveImage', inputs: { images: [FACE_NODE_ID, 0] } },
        },
        workflowType: 'regular',
        faceNodeId: FACE_NODE_ID,
        poseNodeId: POSE_NODE_ID,
        bgNodeId: BG_NODE_ID,
        upperNodeIds: [UPPER_NODE_ID],
        accessoryNodeId: opts.accessoryNodeMapped === false ? null : ACCESSORY_NODE_ID,
        facePhasePromptNode: FACE_NODE_ID,
        garmentPhasePromptNode: FACE_NODE_ID,
      })
      .returning();
    if (!workflow) throw new Error('failed to seed workflow template');

    const [[face], [background], [pose]] = await Promise.all([
      env.db
        .insert(schema.modelFaces)
        .values({
          gender: 'women',
          label: 'Model',
          r2Key: 'catalog/m/m.jpg',
          thumbnailKey: 'catalog/m/m.jpg',
          faceSideR2Key: 'catalog/m/m.jpg',
        })
        .returning(),
      env.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'Bg', r2Key: 'catalog/b/b.jpg', thumbnailKey: 'catalog/b/b.jpg' })
        .returning(),
      env.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose',
          r2Key: 'catalog/p/p.jpg',
          thumbnailKey: 'catalog/p/p.jpg',
          workflowTemplateId: workflow.id,
        })
        .returning(),
    ]);
    if (!face || !background || !pose) throw new Error('failed to seed model assets');

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'QUEUED', priority: false, creditsCharged: 2 })
      .returning();
    if (!job) throw new Error('failed to seed job');

    // Selection order is belt-then-necklace; sortOrder (necklace=1, belt=2)
    // must win, so the stacked composite is necklace-on-top regardless.
    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: `inputs/${job.id}/garment.jpg`,
      faceId: face.id,
      poseId: pose.id,
      backgroundId: background.id,
      accessoryCatalogIds: [beltItem.id, necklaceItem.id],
    });

    for (const key of [
      `inputs/${job.id}/garment.jpg`,
      'catalog/m/m.jpg',
      'catalog/p/p.jpg',
      'catalog/b/b.jpg',
    ]) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    return { jobId: job.id as string, userId: user.id as string, beltItem, necklaceItem };
  }

  it('stacks two selected accessory items and patches the single accessory node', async () => {
    const { jobId, userId } = await seedAccessoryJob();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const prompt = comfy.lastPrompt();
    expect(prompt).not.toBeNull();
    const patched = prompt?.prompt as Record<string, { inputs?: Record<string, unknown> }>;

    // The accessory node must be patched with the STACKED composite's filename,
    // not either individual item's own upload — there is only ever one upload
    // task for accessories regardless of how many categories were selected.
    const accessoryImage = patched[ACCESSORY_NODE_ID]?.inputs?.image;
    expect(accessoryImage).toEqual(expect.stringContaining('accessory_'));

    // Exactly one accessory_*.png upload hit ComfyUI for THIS job — not two
    // (one per item). Filtered by jobId (not just the 'accessory_' prefix)
    // since `comfy`'s upload log spans every test in this file.
    const accessoryUploads = comfy
      .uploadedFilenames()
      .filter((name) => name.startsWith(`accessory_${jobId}`));
    expect(accessoryUploads).toHaveLength(1);
    expect(accessoryUploads[0]).toMatch(/^accessory_.*\.png$/);

    // Other nodes patched normally and untouched by the accessory path.
    expect(patched[FACE_NODE_ID]?.inputs?.image).toMatch(/^uploaded-face_/);
    expect(patched[UPPER_NODE_ID]?.inputs?.image).toMatch(/^uploaded-garment_/);
  });

  it('fails the job (with refund) when a selected accessory catalog item no longer exists', async () => {
    const { jobId, userId, beltItem } = await seedAccessoryJob();
    const log = createLogger('test');
    const cfg = {
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log,
    };

    // One of the two selected accessory items is deleted before dispatch —
    // accessoryCatalogIds is a plain uuid[] column with no FK, so the stale id
    // simply stops resolving. Unlike lower/shoe's lenient "not found —
    // skipping", this must fail the whole job: the user explicitly chose it.
    await env.db.delete(schema.catalogItems).where(eq(schema.catalogItems.id, beltItem.id));

    // First attempt — accessory resolution throws, caught by the generic
    // error handler, which re-enqueues (attempts=1, status back to QUEUED) —
    // same MAX_ATTEMPTS=2 retry path every other processing error takes.
    await processJob(cfg, jobId, userId, 'jobs:normal', 'acc-missing-msg-1');
    const [after1] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after1?.status).toBe('QUEUED');
    expect(after1?.attempts).toBe(1);

    await setWorkerStatus(redis, WORKER_ID, 'IDLE');

    // Second attempt — the item is still missing, so this exhausts
    // MAX_ATTEMPTS and the job terminates FAILED with a credit refund.
    await processJob(cfg, jobId, userId, 'jobs:normal', 'acc-missing-msg-2');
    const [after2] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after2?.status).toBe('FAILED');
    expect(after2?.attempts).toBe(2);

    const [bal] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal?.balance).toBe(7); // 5 initial + 2 refund (creditsCharged)

    const ledger = await env.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(ledger.some((e) => e.reason === 'JOB_FAIL_REFUND')).toBe(true);

    // No accessory composite was ever uploaded to ComfyUI for this job — it
    // never got past resolution to the upload step.
    const accessoryUploads = comfy
      .uploadedFilenames()
      .filter((name) => name.startsWith(`accessory_${jobId}`));
    expect(accessoryUploads).toHaveLength(0);
  });

  it('ignores selected accessories entirely when the template has no accessoryNodeId', async () => {
    const { jobId, userId, beltItem } = await seedAccessoryJob({ accessoryNodeMapped: false });
    const log = createLogger('test');
    // A stale item would fail the job if accessories were resolved; they must
    // be skipped without even being looked up.
    await env.db.delete(schema.catalogItems).where(eq(schema.catalogItems.id, beltItem.id));

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-1`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');
    const accessoryUploads = comfy
      .uploadedFilenames()
      .filter((name) => name.startsWith(`accessory_${jobId}`));
    expect(accessoryUploads).toHaveLength(0);
  });
});
