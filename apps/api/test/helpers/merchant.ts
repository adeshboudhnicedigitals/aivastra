import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { generateApiKey } from '../../src/modules/dev/keys.js';
import type { TestApp } from './api.js';

export async function createTestMerchant(
  app: TestApp,
  opts: { isActive?: boolean; balance?: number } = {},
) {
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: `merchant-${randomUUID()}@test.com`,
      displayName: 'Test Merchant',
      emailVerified: true,
    })
    .returning();
  if (!user) throw new Error('failed to create test user');

  const [merchant] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Test Co',
      contactName: 'Test Person',
      phone: '0000000000',
      businessAddress: 'Test Address',
      isActive: opts.isActive ?? true,
      userId: user.id,
    })
    .returning();
  if (!merchant) throw new Error('failed to create test merchant');

  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: opts.balance ?? 100 });

  return {
    merchantId: merchant.id,
    userId: user.id,
    async credits(n: number) {
      await app.db
        .update(schema.userCredits)
        .set({ balance: n })
        .where(eq(schema.userCredits.userId, user.id));
    },
  };
}

export async function createTestApiKey(
  app: TestApp,
  merchantId: string,
  opts: { revoked?: boolean; label?: string } = {},
) {
  const { key, keyHash, keyPrefix } = generateApiKey();
  const [row] = await app.db
    .insert(schema.apiKeys)
    .values({
      merchantId,
      label: opts.label ?? 'test',
      keyHash,
      keyPrefix,
      revokedAt: opts.revoked ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error('failed to create test api key');
  return { id: row.id, key };
}

/**
 * Creates a tryon category plus the workflow template it points at.
 *
 * workflow_templates has six NOT NULL columns with no default — slug, label,
 * jsonContent, poseNodeId, upperNodeIds, garmentPhasePromptNode — so the filler
 * values below are mandatory, not decorative. Shape follows the existing inserts
 * in apps/api/test/shopify-me.test.ts:112.
 */
export async function createTestTryonCategory(
  app: TestApp,
  opts: {
    slug: string;
    name?: string;
    isActive?: boolean;
    templateIsActive?: boolean;
    sortOrder?: number;
  },
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `wf-${randomUUID()}`,
      label: 'Test Tryon WF',
      jsonContent: {},
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test workflow template');

  const [cat] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: opts.name ?? 'Test Category',
      slug: opts.slug,
      workflowTemplateId: wf.id,
      isActive: opts.isActive ?? true,
      sortOrder: opts.sortOrder ?? 0,
    })
    .returning();
  if (!cat) throw new Error('failed to create test tryon category');

  return { categoryId: cat.id, workflowTemplateId: wf.id };
}
