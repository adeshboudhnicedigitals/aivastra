/**
 * Seed the Workflow Comparisons admin tab with rows in every status, backed by
 * real (generated) images in MinIO, so the page layout can be judged locally
 * without waiting for a GPU worker to replay a job.
 *
 * Every row it creates is tagged: demo jobs carry `source = 'comparison_demo'`
 * and image keys live under `comparison-demo/`. Re-running replaces the previous
 * demo set; `--clean` removes it and nothing else.
 *
 * LOCAL ONLY. Refuses to run unless DATABASE_URL points at 127.0.0.1/localhost —
 * see CLAUDE.md "Production safety".
 *
 * Requires: infra up (`pnpm docker:up`), migrations applied, at least one
 * `workflow_templates` row (a prod snapshot or `pnpm seed:admin-demo`).
 *
 * Usage: tsx --env-file=.env scripts/seed-comparison-demo.mts [--clean]
 */
import { randomUUID } from 'node:crypto';
import { createDb, eq, inArray, schema } from '@aivastra/db';
import { createR2Provider } from '@aivastra/storage';
import sharp from 'sharp';

const DEMO_SOURCE = 'comparison_demo';
const KEY_PREFIX = 'comparison-demo';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`${key} not set`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireEnv('DATABASE_URL');
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) {
  console.error('Refusing to seed: DATABASE_URL is not a local database');
  process.exit(1);
}

const storage = createR2Provider({
  endpoint: requireEnv('R2_ENDPOINT'),
  accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  bucket: requireEnv('R2_BUCKET'),
  publicUrl: requireEnv('R2_PUBLIC_URL'),
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE === 'true',
  presignBaseUrl: process.env.R2_PUBLIC_PRESIGN_BASE,
  signEndpoint: process.env.R2_SIGN_ENDPOINT,
});
const { db, close } = createDb(databaseUrl);

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Portrait 3:4 like real try-on output, so the side-by-side layout is judged
// against realistic proportions rather than squares.
async function placeholder(colorHex: string, title: string, subtitle: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">
    <rect width="100%" height="100%" fill="${colorHex}"/>
    <circle cx="384" cy="300" r="120" fill="#ffffff" fill-opacity="0.25"/>
    <rect x="224" y="450" width="320" height="480" rx="40" fill="#ffffff" fill-opacity="0.18"/>
    <text x="50%" y="120" font-family="sans-serif" font-size="56" fill="#ffffff"
      text-anchor="middle">${escapeXml(title)}</text>
    <text x="50%" y="990" font-family="sans-serif" font-size="36" fill="#ffffff"
      text-anchor="middle">${escapeXml(subtitle)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function upload(key: string, buf: Buffer): Promise<void> {
  await storage.putObject(key, buf, 'image/jpeg');
}

async function clean(): Promise<void> {
  const demoJobs = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.source, DEMO_SOURCE));
  if (demoJobs.length === 0) return;
  // workflow_comparisons.source_job_id cascades, and job_outputs/job_inputs
  // cascade from jobs, so deleting the demo jobs removes the whole set.
  await db.delete(schema.jobs).where(
    inArray(
      schema.jobs.id,
      demoJobs.map((j) => j.id),
    ),
  );
  console.log(`removed ${demoJobs.length} demo jobs (and their comparisons)`);
}

type Spec = {
  status: (typeof schema.workflowComparisons.$inferInsert)['status'];
  sourceSource: string;
  hoursAgo: number;
  withGeneral: boolean;
  generalError?: string;
  unsupportedReason?: string;
  originalMs: number;
  generalMs?: number;
};

const SPECS: Spec[] = [
  { status: 'COMPLETED', sourceSource: 'api_tryon', hoursAgo: 2, withGeneral: true, originalMs: 41_200, generalMs: 38_900 },
  { status: 'COMPLETED', sourceSource: 'shopify', hoursAgo: 5, withGeneral: true, originalMs: 52_800, generalMs: 47_300 },
  { status: 'COMPLETED', sourceSource: 'merchant_tryon', hoursAgo: 9, withGeneral: true, originalMs: 36_400, generalMs: 61_500 },
  { status: 'COMPLETED', sourceSource: 'api_tryon', hoursAgo: 26, withGeneral: true, originalMs: 44_000, generalMs: 43_100 },
  { status: 'COMPLETED', sourceSource: 'shopify', hoursAgo: 50, withGeneral: true, originalMs: 49_900, generalMs: 40_800 },
  { status: 'RUNNING', sourceSource: 'api_tryon', hoursAgo: 0.1, withGeneral: true, originalMs: 40_100 },
  { status: 'QUEUED', sourceSource: 'shopify', hoursAgo: 0.3, withGeneral: true, originalMs: 47_000 },
  { status: 'QUEUED', sourceSource: 'merchant_tryon', hoursAgo: 0.5, withGeneral: true, originalMs: 39_000 },
  { status: 'COLLECTED', sourceSource: 'api_tryon', hoursAgo: 1, withGeneral: false, originalMs: 42_000 },
  { status: 'COLLECTED', sourceSource: 'shopify', hoursAgo: 1.5, withGeneral: false, originalMs: 45_500 },
  {
    status: 'FAILED',
    sourceSource: 'api_tryon',
    hoursAgo: 12,
    withGeneral: true,
    generalError: 'COMFY_TIMEOUT',
    originalMs: 43_300,
    generalMs: 300_000,
  },
  {
    status: 'UNSUPPORTED',
    sourceSource: 'shopify',
    hoursAgo: 30,
    withGeneral: false,
    unsupportedReason: 'saree_mannequin_workflow_not_comparable',
    originalMs: 58_000,
  },
  {
    status: 'UNSUPPORTED',
    sourceSource: 'merchant_tryon',
    hoursAgo: 33,
    withGeneral: false,
    unsupportedReason: 'missing_person_input',
    originalMs: 35_000,
  },
  { status: 'EXPIRED', sourceSource: 'api_tryon', hoursAgo: 24 * 8, withGeneral: false, originalMs: 41_000 },
  { status: 'CANCELLED', sourceSource: 'shopify', hoursAgo: 18, withGeneral: true, originalMs: 46_000 },
];

async function seed(): Promise<void> {
  const [template] = await db
    .select({ id: schema.workflowTemplates.id, version: schema.workflowTemplates.version })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.workflowType, 'tryon'))
    .limit(1);
  const [original] = await db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.workflowType, 'tryon'))
    .offset(1)
    .limit(1);
  if (!template) {
    console.error('No tryon workflow_templates row — seed or sync templates first');
    process.exit(1);
  }

  await clean();

  // Origin images are shared by every row: a person and a garment per row would
  // only multiply uploads without changing what the layout has to cope with.
  const personKey = `${KEY_PREFIX}/person.jpg`;
  const garmentKey = `${KEY_PREFIX}/garment.jpg`;
  await upload(personKey, await placeholder('#6b7280', 'PERSON', 'input'));
  await upload(garmentKey, await placeholder('#b45309', 'GARMENT', 'input'));

  let n = 0;
  for (const spec of SPECS) {
    n += 1;
    const createdAt = new Date(Date.now() - spec.hoursAgo * 3_600_000);
    const sourceJobId = randomUUID();
    const generalJobId = spec.withGeneral ? randomUUID() : null;

    const originalKey = `${KEY_PREFIX}/${sourceJobId}/original.jpg`;
    await upload(originalKey, await placeholder('#1d4ed8', 'ORIGINAL', `workflow · row ${n}`));

    await db.insert(schema.jobs).values({
      id: sourceJobId,
      status: 'COMPLETED',
      source: DEMO_SOURCE,
      creditsCharged: 0,
      workerId: 'gpu-demo-1',
      comfyDurationMs: spec.originalMs,
      createdAt,
    });
    await db.insert(schema.jobOutputs).values({ jobId: sourceJobId, resultKey: originalKey });

    if (generalJobId) {
      const done = spec.status === 'COMPLETED';
      await db.insert(schema.jobs).values({
        id: generalJobId,
        status: done ? 'COMPLETED' : spec.status === 'FAILED' ? 'FAILED' : 'QUEUED',
        source: DEMO_SOURCE,
        creditsCharged: 0,
        workerId: spec.status === 'QUEUED' ? null : 'inhouse-demo-1',
        comfyDurationMs: spec.generalMs ?? null,
        errorCode: spec.generalError ?? null,
        queueStream: 'inhouse',
        createdAt,
      });
      if (done) {
        const generalKey = `${KEY_PREFIX}/${sourceJobId}/general.jpg`;
        await upload(generalKey, await placeholder('#047857', 'GENERAL', `workflow · row ${n}`));
        await db.insert(schema.jobOutputs).values({ jobId: generalJobId, resultKey: generalKey });
      }
    }

    const supported = spec.status !== 'UNSUPPORTED';
    await db.insert(schema.workflowComparisons).values({
      sourceJobId,
      generalJobId,
      templateId: template.id,
      templateVersion: template.version,
      status: spec.status,
      unsupportedReason: spec.unsupportedReason ?? null,
      sourceSource: spec.sourceSource,
      sourceTemplateId: original?.id ?? null,
      personKey: supported ? personKey : null,
      garmentKey: supported ? garmentKey : null,
      createdAt,
      updatedAt: createdAt,
    });
  }
  console.log(`seeded ${SPECS.length} comparison rows across all statuses`);
}

try {
  if (process.argv.includes('--clean')) await clean();
  else await seed();
} finally {
  await close();
}
