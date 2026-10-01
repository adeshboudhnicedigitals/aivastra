/**
 * Fill in the "linking" tables that `pnpm seed:admin-demo` leaves empty, so the
 * GarmentTypesTab admin screen (pose<->garment-type workflow assignment,
 * catalogue-template mapping, shot-type defaults) and the lower/shoe
 * catalog<->garment-type linking have something non-trivial to click into
 * locally. `seed:admin-demo` already creates the faces/backgrounds/poses/
 * garment-types themselves — this script only links the rows that already
 * exist and adds 2 fully-node-mapped workflow templates to link them with.
 *
 * Adds:
 *   1. Two `workflow_templates` (regular, active) with lower/shoe/face/bg node
 *      IDs set — the existing demo templates have no lower/shoe nodes, so
 *      nothing exercises that part of the linking UI.
 *   2. A handful of `pose_garment_configs` rows (pose <-> garment-type
 *      workflow/prompt overrides) across a couple of genders.
 *   3. Two `catalogue_templates` (one per gender) with a few
 *      `catalogue_template_looks` and a `catalogue_template_subcategories`
 *      mapping each — the "Catalogue templates" section has nothing to show
 *      without at least one template.
 *   4. A few `catalog_item_subcategories` links (lower/shoe catalog items ->
 *      garment types) plus a default lower/shoe catalog item on one
 *      garment type.
 *   5. Shot-type-workflow defaults (full/half/closeup) for one more garment
 *      type.
 *
 * Idempotent throughout — every insert is guarded by a prior existence check,
 * so re-running just confirms "already present" everywhere.
 *
 * Requires: `pnpm seed:admin-demo` already run (uses its faces/backgrounds/
 * poses/garment-types/catalog items), infra up (`pnpm docker:up`).
 *
 * Usage: tsx --env-file=.env scripts/seed-admin-linking-demo.mts
 */
import { randomUUID } from 'node:crypto';
import { and, createDb, eq, inArray, schema } from '@aivastra/db';
import { createR2Provider, keys } from '@aivastra/storage';
import sharp from 'sharp';

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

// ---------------------------------------------------------------------------
// 1. Two fully node-mapped workflow templates (lower + shoe nodes included)
// ---------------------------------------------------------------------------

async function ensureLinkingTemplate(slug: string, label: string): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.slug, slug));
  if (existing) return existing;

  const [row] = await db
    .insert(schema.workflowTemplates)
    .values({
      slug,
      label,
      jsonContent: {},
      faceNodeId: 'face',
      poseNodeId: 'pose',
      bgNodeId: 'background',
      upperNodeIds: ['upper'],
      lowerNodeId: 'lower',
      shoeNodeId: 'shoe',
      garmentPhasePromptNode: 'garment',
      facePhasePromptNode: 'face_prompt',
      workflowType: 'regular',
      isActive: true,
    })
    .onConflictDoNothing({ target: schema.workflowTemplates.slug })
    .returning({ id: schema.workflowTemplates.id });
  if (row) return row;

  const [fallback] = await db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.slug, slug));
  return fallback;
}

// ---------------------------------------------------------------------------
// 2. pose_garment_configs — link a couple of poses per gender to garment
//    types, overriding the workflow for one and the prompt for the other.
// ---------------------------------------------------------------------------

async function seedPoseGarmentConfigs(
  templateA: { id: string },
  templateB: { id: string },
): Promise<void> {
  // Ordered by id so repeated runs pick the same pose/subcategory pairs —
  // otherwise onConflictDoNothing can't recognize a "different" pairing as
  // already-seeded and keeps adding rows.
  const poses = await db
    .select({
      id: schema.modelPoseAssets.id,
      gender: schema.modelPoseAssets.genderSlug,
    })
    .from(schema.modelPoseAssets)
    .where(eq(schema.modelPoseAssets.isActive, true))
    .orderBy(schema.modelPoseAssets.id);
  const subcats = await db
    .select({
      id: schema.garmentSubcategories.id,
      gender: schema.garmentSubcategories.genderSlug,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.isActive, true))
    .orderBy(schema.garmentSubcategories.id);

  let created = 0;
  for (const gender of ['women', 'men'] as const) {
    const genderPoses = poses.filter((p) => p.gender === gender);
    const genderSubcats = subcats.filter((s) => s.gender === gender);
    if (genderPoses.length < 2 || genderSubcats.length < 2) continue;

    const pairs: [string, string, string, string | null, boolean | null][] = [
      // poseAssetId, subcategoryId, workflowTemplateId, promptOverride, isActiveOverride
      [genderPoses[0].id, genderSubcats[0].id, templateA.id, null, null],
      [
        genderPoses[1].id,
        genderSubcats[1].id,
        templateB.id,
        `Demo override prompt for ${gender} linking test`,
        null,
      ],
    ];
    for (const [poseAssetId, subcategoryId, workflowTemplateId, promptGarmentPhase] of pairs) {
      const inserted = await db
        .insert(schema.poseGarmentConfigs)
        .values({ poseAssetId, subcategoryId, workflowTemplateId, promptGarmentPhase })
        .onConflictDoNothing({
          target: [schema.poseGarmentConfigs.poseAssetId, schema.poseGarmentConfigs.subcategoryId],
        })
        .returning({ id: schema.poseGarmentConfigs.id });
      if (inserted.length > 0) created++;
    }
  }
  console.log(`  pose_garment_configs: ${created} created (rest already present)`);
}

// ---------------------------------------------------------------------------
// 3. catalogue_templates + looks + garment-type mapping
// ---------------------------------------------------------------------------

async function seedCatalogueTemplate(
  gender: string,
  label: string,
  subcategoryLabels: string[],
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.catalogueTemplates.id })
    .from(schema.catalogueTemplates)
    .where(eq(schema.catalogueTemplates.label, label));
  if (existing) {
    console.log(`  catalogue template "${label}": already present, skipping`);
    return;
  }

  const id = randomUUID();
  const thumbnailKey = keys.catalogueTemplateThumb(id);
  const buf = await placeholderJpeg(480, 480, '#6366f1', label);
  await upload(thumbnailKey, buf);
  await db.insert(schema.catalogueTemplates).values({
    id,
    genderSlug: gender,
    label,
    thumbnailKey,
    isActive: true,
  });

  const poses = await db
    .select({ id: schema.modelPoseAssets.id })
    .from(schema.modelPoseAssets)
    .where(
      and(eq(schema.modelPoseAssets.genderSlug, gender), eq(schema.modelPoseAssets.isActive, true)),
    )
    .limit(2);
  const backgrounds = await db
    .select({ id: schema.modelBackgrounds.id })
    .from(schema.modelBackgrounds)
    .where(eq(schema.modelBackgrounds.isActive, true))
    .limit(2);
  for (let i = 0; i < Math.min(poses.length, backgrounds.length); i++) {
    await db.insert(schema.catalogueTemplateLooks).values({
      templateId: id,
      poseAssetId: poses[i].id,
      backgroundId: backgrounds[i].id,
      sortOrder: i,
    });
  }

  const subcats = await db
    .select({ id: schema.garmentSubcategories.id, label: schema.garmentSubcategories.label })
    .from(schema.garmentSubcategories)
    .where(
      and(
        eq(schema.garmentSubcategories.genderSlug, gender),
        inArray(schema.garmentSubcategories.label, subcategoryLabels),
      ),
    );
  for (const subcat of subcats) {
    await db
      .insert(schema.catalogueTemplateSubcategories)
      .values({ templateId: id, subcategoryId: subcat.id })
      .onConflictDoNothing({
        target: [
          schema.catalogueTemplateSubcategories.templateId,
          schema.catalogueTemplateSubcategories.subcategoryId,
        ],
      });
  }
  console.log(
    `  catalogue template "${label}": created with ${Math.min(poses.length, backgrounds.length)} looks, mapped to ${subcats.length} garment type(s)`,
  );
}

// ---------------------------------------------------------------------------
// 4. catalog_item_subcategories — link a few lower/shoe catalog items to
//    garment types, and set one garment type's default lower/shoe item.
// ---------------------------------------------------------------------------

async function seedCatalogItemLinks(): Promise<void> {
  const [saree] = await db
    .select({ id: schema.garmentSubcategories.id })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.label, 'Saree'));
  const [kurti] = await db
    .select({ id: schema.garmentSubcategories.id })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.label, 'Kurti'));
  if (!saree || !kurti) {
    console.log('  catalog_item_subcategories: Saree/Kurti garment types not found, skipping');
    return;
  }

  const lowerItems = await db
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.type, 'lower'))
    .limit(3);
  const shoeItems = await db
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.type, 'shoe'))
    .limit(3);

  let created = 0;
  for (const item of [...lowerItems, ...shoeItems]) {
    for (const subcategoryId of [saree.id, kurti.id]) {
      const inserted = await db
        .insert(schema.catalogItemSubcategories)
        .values({ catalogItemId: item.id, subcategoryId })
        .onConflictDoNothing({
          target: [
            schema.catalogItemSubcategories.catalogItemId,
            schema.catalogItemSubcategories.subcategoryId,
          ],
        })
        .returning({ catalogItemId: schema.catalogItemSubcategories.catalogItemId });
      if (inserted.length > 0) created++;
    }
  }
  console.log(`  catalog_item_subcategories: ${created} links created (rest already present)`);

  if (lowerItems.length > 0 && shoeItems.length > 0) {
    await db
      .update(schema.garmentSubcategories)
      .set({ defaultLowerCatalogId: lowerItems[0].id, defaultShoeCatalogId: shoeItems[0].id })
      .where(eq(schema.garmentSubcategories.id, saree.id));
    console.log('  garment_subcategories: set Saree default lower/shoe catalog item');
  }
}

// ---------------------------------------------------------------------------
// 5. shot-type-workflow defaults for one more garment type
// ---------------------------------------------------------------------------

async function seedShotTypeWorkflows(template: { id: string }): Promise<void> {
  const [kurti] = await db
    .select({ id: schema.garmentSubcategories.id })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.label, 'Kurti'));
  if (!kurti) {
    console.log('  garment_shot_type_workflows: Kurti not found, skipping');
    return;
  }
  let created = 0;
  for (const shotType of ['full', 'half', 'closeup']) {
    const inserted = await db
      .insert(schema.garmentShotTypeWorkflows)
      .values({ garmentTypeId: kurti.id, shotType, workflowTemplateId: template.id })
      .onConflictDoNothing({
        target: [
          schema.garmentShotTypeWorkflows.garmentTypeId,
          schema.garmentShotTypeWorkflows.shotType,
        ],
      })
      .returning({ id: schema.garmentShotTypeWorkflows.id });
    if (inserted.length > 0) created++;
  }
  console.log(`  garment_shot_type_workflows: ${created} created for Kurti (rest already present)`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding admin linking demo data...');

  console.log('Step 1/5: workflow templates with lower/shoe node IDs');
  const templateA = await ensureLinkingTemplate('demo-link-template-a', 'Demo Linking Template A');
  const templateB = await ensureLinkingTemplate('demo-link-template-b', 'Demo Linking Template B');

  console.log('Step 2/5: pose_garment_configs (pose <-> garment-type overrides)');
  await seedPoseGarmentConfigs(templateA, templateB);

  console.log('Step 3/5: catalogue templates + looks + garment-type mapping');
  await seedCatalogueTemplate('women', 'Demo Everyday Looks (Women)', ['Kurti', 'Saree']);
  await seedCatalogueTemplate('men', 'Demo Everyday Looks (Men)', ['Full Sleeve Shirt', 'T-Shirt']);

  console.log('Step 4/5: catalog item <-> garment-type links + defaults');
  await seedCatalogItemLinks();

  console.log('Step 5/5: shot-type workflow defaults');
  await seedShotTypeWorkflows(templateA);

  console.log('✅ Admin linking demo data seeding complete!');
  console.log('   View at http://localhost:5173 → Garment Types → click a type to see pose/');
  console.log('   catalogue-template/shot-type linking panels.');
  await close();
}

main().catch((err) => {
  console.error('❌ Seeding admin linking demo data failed:', err);
  process.exit(1);
});
