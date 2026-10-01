/**
 * Layer richer admin-panel demo data on top of `pnpm db:seed`.
 *
 * `db:seed` gives you users/merchants/catalog items/60 bare jobs (no
 * job_inputs, no job_outputs, no Shopify link)/8 Shopify stores + ledgers —
 * enough for the Users and Payments pages, but the admin Jobs and Shopify
 * Stores pages have nothing to actually click into: no face/background/pose
 * thumbnails, no output images, no job tied to a Shopify store or shopper.
 *
 * This script:
 *   1. Seeds model_faces / model_backgrounds / model_pose_assets /
 *      garment_subcategories with real (generated) placeholder images
 *      uploaded to MinIO, if none exist yet.
 *   1.5. Adds a few "company" Shopify stores — shop_email containing
 *      "nicedigitals", matching ShopifyStoresPage's Company/Customers tab
 *      split — since db:seed's 8 stores are all customer-shaped and the
 *      Company tab would otherwise have nothing to show.
 *   2. Adds a few Shopify shoppers per existing store (company stores included).
 *   3. Inserts three fresh batches of *fully-populated* jobs — platform
 *      try-on/catalog jobs, merchant-catalog jobs, and Shopify storefront
 *      jobs — each with job_inputs, job_outputs (for completed ones), and a
 *      COMFY_DISPATCH job_event, spread across every JobStatus and source.
 *
 * Idempotent for the reference data (step 1), company stores (step 1.5), and
 * Shopify shoppers (step 2) — all skip creation if matching rows already
 * exist. NOT idempotent for jobs (step 3): re-running adds another batch,
 * same as db:seed's own job seeding.
 *
 * Requires: `pnpm db:seed` already run (uses its users/merchants/catalog
 * items/Shopify stores), infra up (`pnpm docker:up`), migrations applied.
 *
 * Usage: tsx --env-file=.env scripts/seed-admin-demo-data.mts
 */
import { randomUUID } from 'node:crypto';
import { createDb, eq, schema, sql } from '@aivastra/db';
import { createR2Provider, keys } from '@aivastra/storage';
import sharp from 'sharp';

const dayMs = 24 * 60 * 60 * 1000;
const now = Date.now();

// Small local randomness helpers — @faker-js/faker is only a dependency of
// packages/db, not hoisted to the repo root, and this script lives under
// the root scripts/ dir. Not worth adding a root devDependency for dummy data.
const FIRST_NAMES = [
  'Aarav',
  'Vivaan',
  'Aditi',
  'Isha',
  'Kabir',
  'Meera',
  'Rohan',
  'Zoya',
  'Devansh',
  'Priya',
];
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randBool(pTrue = 0.5): boolean {
  return Math.random() < pTrue;
}
function randomFirstName(): string {
  return pick(FIRST_NAMES);
}
function randomEmail(): string {
  const n = randomFirstName().toLowerCase();
  return `${n}.${randomUUID().slice(0, 6)}@example-shopper.test`;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`${key} not set`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = requireEnv('DATABASE_URL');
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

const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#22c55e',
  '#f59e0b',
  '#0ea5e9',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#84cc16',
  '#f97316',
];

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function placeholderJpeg(
  width: number,
  height: number,
  colorHex: string,
  label: string,
): Promise<Buffer> {
  const fontSize = Math.round(Math.min(width, height) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${colorHex}"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff"
      text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function upload(key: string, buf: Buffer): Promise<void> {
  await storage.putObject(key, buf, 'image/jpeg');
}

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function daysAgo(n: number): Date {
  return new Date(now - n * dayMs);
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

// ---------------------------------------------------------------------------
// 1. Reference data: faces, backgrounds, poses, garment subcategories
// ---------------------------------------------------------------------------

const GENDERS = ['men', 'women', 'boys', 'girls'] as const;
const CONTINENTS = ['asia', 'europe', 'africa', 'north_america'];

async function seedFaces(): Promise<{ id: string; gender: string }[]> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.modelFaces);
  if (c > 0) {
    console.log(`  faces: ${c} already present, skipping creation`);
    return db
      .select({ id: schema.modelFaces.id, gender: schema.modelFaces.gender })
      .from(schema.modelFaces);
  }
  console.log('  faces: creating 8...');
  const rows: { id: string; gender: string }[] = [];
  let idx = 0;
  for (const gender of GENDERS) {
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      const label = `${randomFirstName()} (${gender})`;
      const r2Key = keys.modelFace(id);
      const thumbnailKey = keys.modelFaceThumb(id);
      const buf = await placeholderJpeg(480, 720, colorFor(idx), `Face ${idx + 1}`);
      await upload(r2Key, buf);
      await upload(thumbnailKey, buf);
      await db.insert(schema.modelFaces).values({
        id,
        gender,
        label,
        continent: pick(CONTINENTS),
        r2Key,
        thumbnailKey,
        tags: pick([['warm tone'], ['closeup'], ['studio'], []]),
        isActive: true,
        sortOrder: idx,
      });
      rows.push({ id, gender });
      idx++;
    }
  }
  return rows;
}

async function seedBackgrounds(): Promise<{ id: string }[]> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.modelBackgrounds);
  if (c > 0) {
    console.log(`  backgrounds: ${c} already present, skipping creation`);
    return db.select({ id: schema.modelBackgrounds.id }).from(schema.modelBackgrounds);
  }
  console.log('  backgrounds: creating 8...');
  const rows: { id: string }[] = [];
  const labels = [
    'Studio White',
    'Outdoor Garden',
    'Urban Street',
    'Beach Sunset',
    'Marble Interior',
    'Cafe Window',
    'Minimal Grey',
    'Festive Backdrop',
  ];
  for (let i = 0; i < labels.length; i++) {
    const id = randomUUID();
    const r2Key = keys.modelBackground(id);
    const thumbnailKey = keys.modelBackgroundThumb(id);
    const buf = await placeholderJpeg(720, 480, colorFor(i + 3), labels[i]);
    await upload(r2Key, buf);
    await upload(thumbnailKey, buf);
    await db.insert(schema.modelBackgrounds).values({
      id,
      label: labels[i],
      r2Key,
      thumbnailKey,
      isWhiteBg: i === 0,
      isActive: true,
      sortOrder: i,
    });
    rows.push({ id });
  }
  return rows;
}

async function seedPoses(workflowTemplateId: string): Promise<{ id: string; gender: string }[]> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.modelPoseAssets);
  if (c > 0) {
    console.log(`  poses: ${c} already present, skipping creation`);
    return db
      .select({ id: schema.modelPoseAssets.id, gender: schema.modelPoseAssets.genderSlug })
      .from(schema.modelPoseAssets)
      .then((rows) => rows.map((r) => ({ id: r.id, gender: r.gender ?? 'women' })));
  }
  console.log('  poses: creating 8...');
  const shotTypes = ['full', 'half', 'closeup'];
  const rows: { id: string; gender: string }[] = [];
  let idx = 0;
  for (const gender of GENDERS) {
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      const displayName = `${pick(['Standing', 'Walking', 'Hands-on-hip', 'Side profile'])} ${idx + 1}`;
      const r2Key = keys.modelPose(id);
      const thumbnailKey = keys.modelPoseThumb(id);
      const buf = await placeholderJpeg(480, 720, colorFor(idx + 5), displayName);
      await upload(r2Key, buf);
      await upload(thumbnailKey, buf);
      await db.insert(schema.modelPoseAssets).values({
        id,
        label: displayName,
        displayName,
        poseVariant: null,
        shotType: pick(shotTypes),
        r2Key,
        thumbnailKey,
        genderSlug: gender,
        workflowTemplateId,
        isActive: true,
        sortOrder: idx,
      });
      rows.push({ id, gender });
      idx++;
    }
  }
  return rows;
}

async function seedGarmentTypes(): Promise<{ id: string; gender: string }[]> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.garmentSubcategories);
  if (c > 0) {
    console.log(`  garment types: ${c} already present, skipping creation`);
    return db
      .select({
        id: schema.garmentSubcategories.id,
        gender: schema.garmentSubcategories.genderSlug,
      })
      .from(schema.garmentSubcategories);
  }
  console.log('  garment types: creating 8...');
  const namesByGender: Record<(typeof GENDERS)[number], string[]> = {
    men: ['Full Sleeve Shirt', 'T-Shirt'],
    women: ['Kurti', 'Saree'],
    boys: ['Casual Shirt', 'Shorts Set'],
    girls: ['Frock', 'Skirt Top'],
  };
  const rows: { id: string; gender: string }[] = [];
  let idx = 0;
  for (const gender of GENDERS) {
    for (const label of namesByGender[gender]) {
      const id = randomUUID();
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const thumbnailKey = keys.subcategoryThumb(id);
      const buf = await placeholderJpeg(480, 480, colorFor(idx + 2), label);
      await upload(thumbnailKey, buf);
      await db.insert(schema.garmentSubcategories).values({
        id,
        genderSlug: gender,
        slug,
        label,
        thumbnailKey,
        isActive: true,
        sortOrder: idx,
        requiresLowerUpload: label === 'Saree',
      });
      rows.push({ id, gender });
      idx++;
    }
  }
  return rows;
}

async function ensureRegularWorkflowTemplate(): Promise<string> {
  const [existing] = await db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.slug, 'admin-demo-regular-template'));
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'admin-demo-regular-template',
      label: 'Admin Demo Regular Template',
      jsonContent: {},
      poseNodeId: 'pose',
      upperNodeIds: ['upper'],
      garmentPhasePromptNode: 'garment',
      workflowType: 'regular',
      isActive: true,
    })
    .onConflictDoNothing({ target: schema.workflowTemplates.slug })
    .returning({ id: schema.workflowTemplates.id });
  if (row) return row.id;
  const [fallback] = await db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.slug, 'admin-demo-regular-template'));
  return fallback.id;
}

// ---------------------------------------------------------------------------
// 1.5. Company (internal test) Shopify stores
//
// ShopifyStoresPage's Company/Customers tabs split on shop_email containing
// "nicedigitals" — real internal test installs use that pattern (see
// COMPANY_EMAIL_MARKER in apps/admin-web/src/pages/ShopifyStoresPage.tsx).
// The 8 stores from db:seed are all "customer"-shaped; without at least a
// few real company-marked rows the Company tab has nothing to show.
// ---------------------------------------------------------------------------

const COMPANY_TEST_STORES = [
  {
    domain: 'nicedigitals-qa1.myshopify.com',
    name: 'NiceDigitals QA Store 1',
    owner: 'Arjun (NiceDigitals QA)',
    email: 'arjun.nicedigitals@gmail.com',
    phone: '+91 90000 11111',
  },
  {
    domain: 'nicedigitals-qa2.myshopify.com',
    name: 'NiceDigitals QA Store 2',
    owner: 'Priya (NiceDigitals QA)',
    email: 'priya.nicedigitals@gmail.com',
    phone: '+91 90000 22222',
  },
  {
    domain: 'nicedigitals-staging-test.myshopify.com',
    name: 'NiceDigitals Staging Test',
    owner: 'Meera (NiceDigitals QA)',
    email: 'meera.nicedigitals@gmail.com',
    phone: '+91 90000 33333',
  },
];

async function seedCompanyTestStores(): Promise<{ id: string; shopDomain: string }[]> {
  const existing = await db
    .select({ id: schema.shopifyStores.id, shopDomain: schema.shopifyStores.shopDomain })
    .from(schema.shopifyStores)
    .where(sql`${schema.shopifyStores.shopDomain} LIKE 'nicedigitals-%'`);
  const existingDomains = new Set(existing.map((s) => s.shopDomain));
  const toCreate = COMPANY_TEST_STORES.filter((s) => !existingDomains.has(s.domain));
  if (toCreate.length === 0) {
    console.log(`  company stores: ${existing.length} already present, skipping creation`);
    return existing;
  }
  console.log(`  company stores: creating ${toCreate.length}...`);

  const created: { id: string; shopDomain: string }[] = [];
  for (const [i, spec] of toCreate.entries()) {
    const installedAt = daysAgo(randInt(3, 25));
    const [store] = await db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: spec.domain,
        shopifyShopId: 9_100_000_000 + i,
        accessToken: '0000000000000000:0000000000000000:dummy_seeded_access_token',
        scope: 'read_products,write_products,read_themes',
        ianaTimezone: 'Asia/Kolkata',
        installedAt,
        shopEmail: spec.email,
        shopName: spec.name,
        shopOwnerName: spec.owner,
        shopPhone: spec.phone,
        shopAddress: 'NiceDigitals Office, Hyderabad, India',
        // These ARE the team's own internal test installs — genuinely
        // partner-development stores, not just labeled that way for realism.
        partnerDevelopment: true,
      })
      .onConflictDoNothing({ target: schema.shopifyStores.shopDomain })
      .returning({ id: schema.shopifyStores.id, shopDomain: schema.shopifyStores.shopDomain });
    if (!store) continue;

    await db.insert(schema.shopifyStoreCredits).values({
      storeId: store.id,
      balance: randInt(20, 300),
      updatedAt: new Date(),
    });
    const ledgerEntries = [
      { delta: 50, reason: 'TRIAL_GRANT', daysAgo: randInt(20, 25) },
      { delta: -1, reason: 'JOB_DISPATCH', daysAgo: randInt(1, 15) },
      { delta: -1, reason: 'JOB_DISPATCH', daysAgo: randInt(1, 15) },
    ];
    for (const entry of ledgerEntries) {
      await db.insert(schema.shopifyCreditLedger).values({
        storeId: store.id,
        delta: entry.delta,
        reason: entry.reason,
        createdAt: daysAgo(entry.daysAgo),
      });
    }
    created.push(store);
  }
  return [...existing, ...created];
}

// ---------------------------------------------------------------------------
// 2. Shopify shoppers
// ---------------------------------------------------------------------------

async function seedShoppers(storeId: string): Promise<{ id: string }[]> {
  const existing = await db
    .select({ id: schema.shopifyShoppers.id })
    .from(schema.shopifyShoppers)
    .where(eq(schema.shopifyShoppers.storeId, storeId));
  if (existing.length > 0) return existing;

  const rows: { id: string }[] = [];
  const shopperCount = randInt(3, 6);
  for (let i = 0; i < shopperCount; i++) {
    const hasEmail = i % 2 === 0;
    const firstSeenDaysAgo = randInt(1, 40);
    const [row] = await db
      .insert(schema.shopifyShoppers)
      .values({
        storeId,
        clientId: randomUUID(),
        shopifyCustomerId: randBool(0.5) ? randInt(700000000, 799999999) : null,
        email: hasEmail ? randomEmail() : null,
        emailConsent: hasEmail && randBool(0.5),
        emailCapturedAt: hasEmail ? daysAgo(firstSeenDaysAgo - 1) : null,
        firstSeenAt: daysAgo(firstSeenDaysAgo),
        lastSeenAt: daysAgo(Math.max(0, firstSeenDaysAgo - randInt(0, 5))),
      })
      .returning({ id: schema.shopifyShoppers.id });
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. Jobs
// ---------------------------------------------------------------------------

const STATUSES = [
  'QUEUED',
  'HELD',
  'PREPROCESSING',
  'GENERATING',
  'UPLOADING',
  'PENDING_MANNEQUIN',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
type Status = (typeof STATUSES)[number];

const WORKERS = ['w1', 'w2', 'w3', 'w4'];
const ERROR_CODES = ['ERR_WORKER_TIMEOUT', 'ERR_COMFY_FAILED', 'ERR_UPLOAD_FAILED'];
const FLAG_REASONS = [
  'multiple_body_parts',
  'nudity',
  'draping_issue',
  'additional_assets',
  'texture_issue',
  'wrong_input_uploaded',
];

interface JobTiming {
  createdAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  workerId: string | null;
  attempts: number;
  errorCode: string | null;
  comfyDurationMs: number | null;
}

function buildTiming(status: Status, createdDaysAgo: number): JobTiming {
  const createdAt = daysAgo(createdDaysAgo);
  if (status === 'QUEUED') {
    return {
      createdAt,
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      workerId: null,
      attempts: 0,
      errorCode: null,
      comfyDurationMs: null,
    };
  }
  if (status === 'HELD') {
    return {
      createdAt,
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      workerId: null,
      attempts: 0,
      errorCode: null,
      comfyDurationMs: null,
    };
  }
  const startedAt = new Date(createdAt.getTime() + 5_000);
  const inProgress = ['PREPROCESSING', 'GENERATING', 'UPLOADING', 'PENDING_MANNEQUIN'].includes(
    status,
  );
  if (inProgress) {
    return {
      createdAt,
      queuedAt: createdAt,
      startedAt,
      completedAt: null,
      workerId: pick(WORKERS),
      attempts: 1,
      errorCode: null,
      comfyDurationMs: null,
    };
  }
  const durationMs = randInt(18_000, 90_000);
  const completedAt = new Date(startedAt.getTime() + durationMs);
  return {
    createdAt,
    queuedAt: createdAt,
    startedAt,
    completedAt,
    workerId: pick(WORKERS),
    attempts: status === 'FAILED' ? randInt(1, 2) : 1,
    errorCode: status === 'FAILED' ? pick(ERROR_CODES) : null,
    comfyDurationMs: status === 'COMPLETED' ? durationMs : null,
  };
}

async function insertOutputAndEvent(
  jobId: string,
  status: Status,
  workflowTemplateId: string,
  index: number,
): Promise<void> {
  if (status === 'COMPLETED') {
    const resultKey = keys.output(jobId, 'png');
    const thumbnailKey = keys.outputThumb(jobId);
    const buf = await placeholderJpeg(720, 1080, colorFor(index), 'Result');
    await upload(resultKey, buf);
    await upload(thumbnailKey, buf);
    await db.insert(schema.jobOutputs).values({
      jobId,
      resultKey,
      thumbnailKey,
      assetKind: 'ORIGINAL',
      downloadedAt: index % 4 === 0 ? daysAgo(0) : null,
    });
  }
  if (status !== 'QUEUED' && status !== 'HELD') {
    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'COMFY_DISPATCH',
      payload: { workflowTemplateId },
    });
  }
  if (status === 'FAILED') {
    await db.insert(schema.jobEvents).values({
      jobId,
      eventType: 'JOB_FAILED',
      payload: { errorCode: pick(ERROR_CODES) },
    });
  }
}

async function seedRichUserJobs(
  users: { id: string }[],
  faces: { id: string; gender: string }[],
  backgrounds: { id: string }[],
  poses: { id: string; gender: string }[],
  garmentTypes: { id: string; gender: string }[],
  lowerItems: { id: string }[],
  shoeItems: { id: string }[],
  workflowTemplateId: string,
  adminUserId: string,
  count: number,
): Promise<void> {
  console.log(`  seeding ${count} rich platform tryon/catalog jobs...`);
  for (let i = 0; i < count; i++) {
    const status = STATUSES[i % STATUSES.length];
    const user = pick(users);
    const gender = pick(GENDERS);
    const face = faces.find((f) => f.gender === gender) ?? pick(faces);
    const pose = poses.find((p) => p.gender === gender) ?? pick(poses);
    const garmentType = garmentTypes.find((g) => g.gender === gender) ?? pick(garmentTypes);
    const background = pick(backgrounds);
    const timing = buildTiming(status, randInt(0, 30));
    const source = pick(['tryon', 'catalog', 'saree', 'saree_mannequin'] as const);
    const hasLower = randBool(0.5);
    const hasShoe = randBool(0.5);
    const flagged = status === 'COMPLETED' && i % 9 === 0;

    const jobId = randomUUID();
    await db.insert(schema.jobs).values({
      id: jobId,
      userId: user.id,
      status,
      workerId: timing.workerId,
      priority: i % 10 === 0,
      queueStream: 'normal',
      watermark: i % 3 === 0,
      creditsCharged: randInt(1, 3),
      attempts: timing.attempts,
      errorCode: timing.errorCode,
      source,
      createdAt: timing.createdAt,
      queuedAt: timing.queuedAt,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      comfyDurationMs: timing.comfyDurationMs,
      flagged,
      flagReason: flagged ? pick(FLAG_REASONS) : null,
      flagNote: flagged ? 'Looks off around the shoulder seam — needs a second pass.' : null,
      flaggedAt: flagged ? timing.completedAt : null,
      flaggedBy: flagged ? adminUserId : null,
      resolvedAt: flagged && i % 27 === 0 ? daysAgo(0) : null,
      resolvedNote: flagged && i % 27 === 0 ? 'Regenerated with a corrected pose.' : null,
      resolvedBy: flagged && i % 27 === 0 ? adminUserId : null,
    });
    await db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: `inputs/${jobId}/garment.jpg`,
      faceId: face.id,
      backgroundId: background.id,
      poseId: pose.id,
      garmentTypeId: garmentType.id,
      lowerCatalogId: hasLower && lowerItems.length > 0 ? pick(lowerItems).id : null,
      shoeCatalogId: hasShoe && shoeItems.length > 0 ? pick(shoeItems).id : null,
      params: { workflowTemplateId, dispatchTemplateVersion: 1 },
    });
    await insertOutputAndEvent(jobId, status, workflowTemplateId, i);
  }
}

async function seedMerchantJobs(
  merchants: { id: string; userId: string }[],
  garmentTypes: { id: string; gender: string }[],
  lowerItems: { id: string }[],
  shoeItems: { id: string }[],
  workflowTemplateId: string,
  count: number,
): Promise<void> {
  if (merchants.length === 0) {
    console.log('  no merchants found, skipping merchant-catalog jobs');
    return;
  }
  console.log(`  seeding ${count} merchant-catalog jobs...`);
  for (let i = 0; i < count; i++) {
    const status = STATUSES[i % STATUSES.length];
    const merchant = pick(merchants);
    const garmentType = pick(garmentTypes);
    const timing = buildTiming(status, randInt(0, 25));

    const jobId = randomUUID();
    await db.insert(schema.jobs).values({
      id: jobId,
      userId: merchant.userId,
      merchantId: merchant.id,
      status,
      workerId: timing.workerId,
      priority: false,
      queueStream: 'normal',
      creditsCharged: 1,
      attempts: timing.attempts,
      errorCode: timing.errorCode,
      source: 'merchant_catalog',
      createdAt: timing.createdAt,
      queuedAt: timing.queuedAt,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      comfyDurationMs: timing.comfyDurationMs,
    });
    await db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: `merchant-catalog/${merchant.id}/${jobId}/garment.jpg`,
      garmentTypeId: garmentType.id,
      lowerCatalogId: lowerItems.length > 0 && i % 2 === 0 ? pick(lowerItems).id : null,
      shoeCatalogId: shoeItems.length > 0 && i % 3 === 0 ? pick(shoeItems).id : null,
      params: { kind: 'merchant_catalog', workflowTemplateId },
    });
    await insertOutputAndEvent(jobId, status, workflowTemplateId, i + 100);
  }
}

async function seedShopifyJobs(
  stores: { id: string; shopDomain: string }[],
  workflowTemplateId: string,
  countPerStore: number,
): Promise<void> {
  console.log(`  seeding ~${countPerStore} Shopify storefront jobs per store...`);
  for (const store of stores) {
    const shoppers = await seedShoppers(store.id);
    for (let i = 0; i < countPerStore; i++) {
      const status = STATUSES[(i + store.shopDomain.length) % STATUSES.length];
      const shopper = shoppers.length > 0 && i % 4 !== 0 ? pick(shoppers) : null;
      const timing = buildTiming(status, randInt(0, 20));
      const jobId = randomUUID();
      const shopifyProductId = randInt(8000000000000, 8999999999999);

      await db.insert(schema.jobs).values({
        id: jobId,
        shopifyStoreId: store.id,
        shopifyShopperId: shopper?.id ?? null,
        customerPhotoKey: `shopify-customer-photos/${store.id}/${jobId}.jpg`,
        status,
        workerId: timing.workerId,
        priority: false,
        queueStream: 'normal',
        creditsCharged: 1,
        attempts: timing.attempts,
        errorCode: timing.errorCode,
        source: 'shopify',
        createdAt: timing.createdAt,
        queuedAt: timing.queuedAt,
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
        comfyDurationMs: timing.comfyDurationMs,
      });
      await db.insert(schema.jobInputs).values({
        jobId,
        upperGarmentKey: `shopify-products/${store.id}/${shopifyProductId}.jpg`,
        faceId: null,
        backgroundId: null,
        poseId: null,
        params: {
          kind: 'shopify',
          shopifyProductId,
          workflowTemplateId,
          dispatchTemplateVersion: 1,
        },
      });
      await insertOutputAndEvent(jobId, status, workflowTemplateId, i + 200);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding admin-panel demo data...');

  console.log('Step 1/3: reference data (faces, backgrounds, poses, garment types)');
  const regularTemplateId = await ensureRegularWorkflowTemplate();
  const faces = await seedFaces();
  const backgrounds = await seedBackgrounds();
  const poses = await seedPoses(regularTemplateId);
  const garmentTypes = await seedGarmentTypes();

  const users = await db.select({ id: schema.users.id }).from(schema.users);
  if (users.length === 0) {
    console.error('No users found — run `pnpm db:seed` first.');
    process.exit(1);
  }
  const merchantRows = await db
    .select({ id: schema.merchants.id, userId: schema.merchants.userId })
    .from(schema.merchants);
  const lowerItems = await db
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.type, 'lower'))
    .limit(200);
  const shoeItems = await db
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.type, 'shoe'))
    .limit(200);

  console.log('Step 1.5/3: company (internal test) Shopify stores');
  await seedCompanyTestStores();

  const stores = await db
    .select({ id: schema.shopifyStores.id, shopDomain: schema.shopifyStores.shopDomain })
    .from(schema.shopifyStores);
  if (stores.length === 0) {
    console.error('No Shopify stores found — run `pnpm db:seed` first.');
    process.exit(1);
  }
  let [adminRow] = await db
    .select({ userId: schema.adminUsers.userId })
    .from(schema.adminUsers)
    .limit(1);
  if (!adminRow) adminRow = { userId: pick(users).id };

  console.log('Step 2/3: Shopify shoppers per store');
  for (const store of stores) {
    await seedShoppers(store.id);
  }

  console.log('Step 3/3: jobs (platform, merchant-catalog, Shopify)');
  const workflowTemplateForJobs = poses[0]?.id ? regularTemplateId : regularTemplateId;
  await seedRichUserJobs(
    users,
    faces,
    backgrounds,
    poses,
    garmentTypes,
    lowerItems,
    shoeItems,
    workflowTemplateForJobs,
    adminRow.userId,
    40,
  );
  await seedMerchantJobs(
    merchantRows.filter((m): m is { id: string; userId: string } => m.userId != null),
    garmentTypes,
    lowerItems,
    shoeItems,
    workflowTemplateForJobs,
    18,
  );
  await seedShopifyJobs(stores, workflowTemplateForJobs, 5);

  console.log('✅ Admin demo data seeding complete!');
  console.log('   View at http://localhost:5173 → Jobs / Shopify Stores.');
  await close();
}

main().catch((err) => {
  console.error('❌ Seeding admin demo data failed:', err);
  process.exit(1);
});
