import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// One-step saree workflow with an OPTIONAL fourth (blouse) image: body = upper,
// pallu = third (required), blouse = fourth (optional, opt-in per garment type).
describe('POST /v1/jobs/tryon — optional fourth garment (blouse)', () => {
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
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });

  async function registerUser(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const accessToken = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token: accessToken, userId: user.id };
  }

  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  async function balanceOf(userId: string) {
    const [row] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    return row?.balance;
  }

  async function seedCreditPlan() {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing();
  }

  // Seeds everything a one-step job needs. `fourthNodeId: null` models a pose whose
  // workflow cannot consume a blouse; `allowsFourthUpload: false` a garment type that
  // never opted in.
  async function seedScenario(opts: { fourthNodeId: string | null; allowsFourthUpload: boolean }) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `saree-blouse-${stamp}`,
        label: 'Saree blouse',
        jsonContent: {},
        workflowType: 'regular',
        faceNodeId: '',
        poseNodeId: '1',
        bgNodeId: '',
        upperNodeIds: ['10'],
        thirdNodeId: '11',
        fourthNodeId: opts.fourthNodeId,
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'women', label: 'F', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        genderSlug: 'women',
        label: 'BG',
        r2Key: 'bg.jpg',
        thumbnailKey: 'bg.jpg',
        isActive: true,
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        genderSlug: 'women',
        label: 'Pose',
        r2Key: 'pose.jpg',
        thumbnailKey: 'pose.jpg',
        isActive: true,
        workflowTemplateId: wf.id,
      })
      .returning();
    const [gt] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `saree-blouse-${stamp}`,
        label: 'Saree with blouse',
        requiresThirdUpload: true,
        allowsFourthUpload: opts.allowsFourthUpload,
      })
      .returning();
    return { faceId: face.id, backgroundId: bg.id, poseId: pose.id, garmentTypeId: gt.id };
  }

  async function postTryon(
    token: string,
    userId: string,
    s: Awaited<ReturnType<typeof seedScenario>>,
    withBlouse: boolean,
  ) {
    // INPUT_GARMENT_KEY pins the shape to inputs/<upload-uuid>/garment.jpg.
    const newKey = () => `inputs/${randomUUID()}/garment.jpg`;
    const upper = newKey();
    const pallu = newKey();
    const blouse = newKey();
    await Promise.all([upper, pallu, blouse].map((k) => bindUploadKey(userId, k)));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: upper,
          thirdGarmentKey: pallu,
          ...(withBlouse ? { fourthGarmentKey: blouse } : {}),
          faceId: s.faceId,
          backgroundId: s.backgroundId,
          poseIds: [s.poseId],
          garmentTypeId: s.garmentTypeId,
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    return { res, blouse };
  }

  async function jobInputsFor(jobId: string) {
    const [row] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    return row;
  }

  it('persists the blouse key when the garment type opts in and the workflow maps a node', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('blouse-happy@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({ fourthNodeId: '12', allowsFourthUpload: true });

    const { res, blouse } = await postTryon(token, userId, s, true);

    expect(res.statusCode).toBeLessThan(300);
    const [jobId] = res.json().jobIds as string[];
    const inputs = await jobInputsFor(jobId);
    expect(inputs?.fourthGarmentKey).toBe(blouse);
    expect(inputs?.thirdGarmentKey).toBeTruthy();
  });

  it('still creates the job with a null fourth key when no blouse is sent (old path unchanged)', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('blouse-absent@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({ fourthNodeId: '12', allowsFourthUpload: true });

    const { res } = await postTryon(token, userId, s, false);

    expect(res.statusCode).toBeLessThan(300);
    const [jobId] = res.json().jobIds as string[];
    expect((await jobInputsFor(jobId))?.fourthGarmentKey).toBeNull();
  });

  it('rejects a blouse for a garment type that has not opted in, charging nothing', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('blouse-not-allowed@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({ fourthNodeId: '12', allowsFourthUpload: false });

    const { res } = await postTryon(token, userId, s, true);

    expect(res.statusCode).toBe(400);
    expect(res.json().error?.message ?? res.body).toMatch(/does not accept a fourth upload/);
    expect(await balanceOf(userId)).toBe(100);
  });

  it("rejects a blouse when the pose's workflow maps no fourth node, charging nothing", async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('blouse-no-node@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({ fourthNodeId: null, allowsFourthUpload: true });

    const { res } = await postTryon(token, userId, s, true);

    expect(res.statusCode).toBe(400);
    expect(res.json().error?.message ?? res.body).toMatch(/no fourth garment node/);
    expect(await balanceOf(userId)).toBe(100);
  });
});
