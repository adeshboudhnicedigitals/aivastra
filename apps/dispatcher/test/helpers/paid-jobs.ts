import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import type { TestEnv } from './containers.js';

export const PAID_PATH_KINDS = [
  'regular',
  'tryon_direct',
  'regenerate',
  'fabric_to_garment',
  'saree_mannequin',
  'saree',
  'merchant_widget',
  'shopify',
  'in_job_mannequin',
] as const;
export type PaidPathKind = (typeof PAID_PATH_KINDS)[number];

export const PATH_FIXTURE_KEY = 'inputs/paths/image.jpg';

/** One queued paid job of each shape, with just enough rows for its processor to reach the worker. */
export async function seedPaidJob(env: TestEnv, kind: PaidPathKind) {
  const [user] = await env.db
    .insert(schema.users)
    .values({ email: `${randomUUID()}@test.invalid` })
    .returning();
  if (!user) throw new Error('missing user');
  await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 4 });
  const graph = {
    '1': { class_type: 'LoadImage', inputs: { image: '' } },
    '2': { class_type: 'LoadImage', inputs: { image: '' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '4': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    p: { class_type: 'LoadImage', inputs: { image: '' } },
    b: { class_type: 'LoadImage', inputs: { image: '' } },
  };
  const [template] = await env.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `paths-${randomUUID()}`,
      label: 'Submission paths',
      jsonContent: graph,
      workflowType: kind === 'regular' ? 'regular' : 'tryon',
      faceNodeId: '1',
      poseNodeId: kind === 'regular' ? 'p' : '1',
      bgNodeId: 'b',
      upperNodeIds: ['2'],
      facePhasePromptNode: '3',
      garmentPhasePromptNode: '3',
      resultNodeId: '4',
      tryonPersonNodeId: '1',
      tryonGarmentNodeId: '2',
      tryonOutputNodeId: '4',
    })
    .returning();
  if (!template) throw new Error('missing template');
  const key = 'inputs/paths/image.jpg';
  const [face] = await env.db
    .insert(schema.modelFaces)
    .values({
      gender: 'women',
      label: 'Fixture',
      r2Key: key,
      thumbnailKey: key,
      faceSideR2Key: key,
    })
    .returning();
  const [bg] = await env.db
    .insert(schema.modelBackgrounds)
    .values({ label: 'Fixture', r2Key: key, thumbnailKey: key })
    .returning();
  const [pose] = await env.db
    .insert(schema.modelPoseAssets)
    .values({
      label: 'Fixture',
      r2Key: key,
      thumbnailKey: key,
      workflowTemplateId: template.id,
    })
    .returning();
  const [merchant] =
    kind === 'merchant_widget'
      ? await env.db
          .insert(schema.merchants)
          .values({
            companyName: 'Fixture',
            contactName: 'Fixture',
            phone: '0000000000',
            businessAddress: 'Fixture',
            isActive: true,
            userId: user.id,
          })
          .returning()
      : [];
  const [store] =
    kind === 'shopify'
      ? await env.db
          .insert(schema.shopifyStores)
          .values({
            shopDomain: `${randomUUID()}.myshopify.com`,
            shopifyShopId: Date.now(),
            accessToken: 'fixture',
            scope: 'read_products',
          })
          .returning()
      : [];
  const [job] = await env.db
    .insert(schema.jobs)
    .values({
      userId: merchant || store ? null : user.id,
      merchantId: merchant?.id,
      shopifyStoreId: store?.id,
      customerPhotoKey: merchant || store ? key : null,
      status: 'QUEUED',
      creditsCharged: kind === 'saree_mannequin' ? 0 : 1,
    })
    .returning();
  if (!job) throw new Error('missing job');
  const params = {
    kind,
    workflowTemplateId: template.id,
    ...(kind === 'tryon_direct' ? { personKey: key } : {}),
    ...(kind === 'regenerate' ? { sourceImageKey: key } : {}),
    ...(kind === 'fabric_to_garment' ? { prompt: 'A fixture garment' } : {}),
    ...(kind === 'saree' ? { modelKey: key } : {}),
  };
  await env.db.insert(schema.jobInputs).values({
    jobId: job.id,
    upperGarmentKey: key,
    faceId: kind === 'regular' || kind === 'saree_mannequin' ? face?.id : null,
    backgroundId: kind === 'regular' ? bg?.id : null,
    poseId: kind === 'regular' ? pose?.id : null,
    params,
  });
  return { user, job, template, face, key, widget: !!(merchant || store) };
}
