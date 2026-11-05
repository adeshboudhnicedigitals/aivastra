import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);
const CONFIG_KEY = 'config:system';

async function createMerchant(app: TestApp, email: string, balance = 100) {
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
  await app.db.insert(schema.userCredits).values({ userId: merchantUser.id, balance });
  return { merchant, merchantUser };
}

async function authHeader(userId: string) {
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
  return { authorization: `Bearer ${token}` };
}

async function seedQuickWorkflow(app: TestApp, isActive = true) {
  const [template] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `quick-${randomUUID()}`,
      label: 'Quick try-on',
      jsonContent: {},
      poseNodeId: '',
      upperNodeIds: [],
      garmentPhasePromptNode: '',
      workflowType: 'quick_tryon',
      tryonPersonNodeId: '10',
      tryonOutputNodeId: '20',
      isActive,
    })
    .returning();
  return template;
}

async function setQuickWorkflow(app: TestApp, id: string | null) {
  const cur = JSON.parse((await app.redis.get(CONFIG_KEY)) ?? '{}');
  await app.redis.set(CONFIG_KEY, JSON.stringify({ ...cur, quickTryonWorkflowTemplateId: id }));
}

async function uploadPhoto(app: TestApp, auth: Record<string, string>) {
  const presigned = await app.inject({
    method: 'POST',
    url: '/v1/merchant/tryon/presign',
    headers: auth,
    payload: { contentType: 'image/jpeg', contentLength: 1024 },
  });
  const { r2Key } = presigned.json() as { r2Key: string };
  await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');
  return r2Key;
}

describe('merchant quick try-on jobs', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);

  afterAll(async () => {
    await setQuickWorkflow(app, null);
    await app?.close();
    await c?.stop();
  });

  it('creates a garment-less job pinned to the configured workflow and charges credits', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'quick-a@example.com');
    const auth = await authHeader(merchantUser.id);
    const template = await seedQuickWorkflow(app);
    await setQuickWorkflow(app, template.id);
    const r2Key = await uploadPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/quick-tryon/jobs',
      headers: auth,
      payload: { customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.merchantId).toBe(merchant.id);
    expect(job.customerPhotoKey).toBe(r2Key);
    expect(job.source).toBe('merchant_tryon');
    expect(job.creditsCharged).toBe(5);

    const [input] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(input.upperGarmentKey).toBeNull();
    expect(input.params).toMatchObject({
      kind: 'quick_tryon',
      workflowTemplateId: template.id,
      dispatchTemplateVersion: template.version,
    });

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(credits.balance).toBe(95);

    // Status is read through the existing merchant job endpoint.
    const status = await app.inject({
      method: 'GET',
      url: `/v1/merchant/tryon/jobs/${jobId}`,
      headers: auth,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: jobId, status: 'QUEUED' });
  });

  it('refuses with 409 and charges nothing when no workflow is configured or it is inactive', async () => {
    const { merchantUser } = await createMerchant(app, 'quick-b@example.com');
    const auth = await authHeader(merchantUser.id);
    const r2Key = await uploadPhoto(app, auth);

    await setQuickWorkflow(app, null);
    const unset = await app.inject({
      method: 'POST',
      url: '/v1/merchant/quick-tryon/jobs',
      headers: auth,
      payload: { customerPhotoKey: r2Key },
    });
    expect(unset.statusCode).toBe(409);

    const inactive = await seedQuickWorkflow(app, false);
    await setQuickWorkflow(app, inactive.id);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/quick-tryon/jobs',
      headers: auth,
      payload: { customerPhotoKey: r2Key },
    });
    expect(res.statusCode).toBe(409);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(credits.balance).toBe(100);
  });

  it("rejects another merchant's photo key", async () => {
    const { merchantUser } = await createMerchant(app, 'quick-c@example.com');
    const { merchantUser: other } = await createMerchant(app, 'quick-d@example.com');
    const template = await seedQuickWorkflow(app);
    await setQuickWorkflow(app, template.id);
    const foreignKey = await uploadPhoto(app, await authHeader(other.id));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/quick-tryon/jobs',
      headers: await authHeader(merchantUser.id),
      payload: { customerPhotoKey: foreignKey },
    });
    expect(res.statusCode).toBe(403);
  });
});
