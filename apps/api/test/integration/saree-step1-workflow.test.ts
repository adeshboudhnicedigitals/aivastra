import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('POST /admin/workflows — saree_step1 workflowType', () => {
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

  async function registerAdmin(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    await app.db
      .insert(schema.adminUsers)
      .values({ userId: user.id, role: 'SUPER_ADMIN', status: 'active' });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const accessToken = await signAccess(
      secret,
      user.id,
      { kind: 'access' },
      app.env.JWT_EXPIRY,
      'admin',
    );
    return accessToken;
  }

  const MANNEQUIN_JSON = {
    '1': {
      class_type: 'LoadImage',
      _meta: { title: 'person' },
      inputs: { image: 'p.jpg' },
    },
    '2': {
      class_type: 'LoadImage',
      _meta: { title: 'garment' },
      inputs: { image: 'g.jpg' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'negative' },
      inputs: { text: 'neg' },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'positive' },
      inputs: { text: 'pos' },
    },
    '5': {
      class_type: 'SaveImage',
      _meta: { title: 'Save Image' },
      inputs: { images: ['1', 0] },
    },
  };

  it('creates a saree_step1 workflow with detected person/garment/output nodes', async () => {
    const token = await registerAdmin('saree-step1-admin@x.com');

    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        slug: 'saree_step1_test',
        label: 'Saree Step 1 Test',
        workflowType: 'saree_step1',
        jsonContent: MANNEQUIN_JSON,
        facePhasePromptNode: '3',
        garmentPhasePromptNode: '4',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workflowType).toBe('saree_step1');
    expect(body.tryonPersonNodeId).toBe('1');
    expect(body.tryonGarmentNodeId).toBe('2');
    expect(body.tryonOutputNodeId).toBe('5');

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, body.id));
    expect(row?.workflowType).toBe('saree_step1');
  });
});
