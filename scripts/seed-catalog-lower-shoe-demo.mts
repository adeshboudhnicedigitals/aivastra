/**
 * Add a small, visible batch of lower-garment and footwear catalog items for
 * local testing of the Lower Garment / Footwear steps (Studio and
 * Fabric-to-Garment both use the same `/v1/catalog/lower|shoe` endpoint).
 *
 * `pnpm db:seed` already inserts ~1000 catalog_items per type, but under
 * `models`-type categories with fake, never-uploaded r2/thumbnail keys — they
 * exist in the DB but every thumbnail 404s. This script instead uploads real
 * generated thumbnails under the real "lower"/"shoe" catalog_types categories,
 * so they render as proper labeled cards.
 *
 * The generated image is a filled garment/shoe *silhouette* on a plain
 * background, not a flat solid-color swatch (what this script originally
 * generated, reusing seed-admin-demo-data.mts's text-label placeholder
 * pattern meant for face/background/pose thumbnails, which are never run
 * through garment segmentation). A real end-to-end generation run patches
 * this image into a ComfyUI workflow that includes a "Bounded Image Crop with
 * Mask" step expecting a real foreground garment shape to segment — a flat
 * color block has no detectable edges, so the mask comes back empty and that
 * node throws `index is out of bounds for dimension with size 0` (confirmed
 * locally: jobs 0bcb84ba... and fd7969c0... both failed on exactly this with
 * the original flat-color placeholders). A filled silhouette shape gives the
 * segmentation step real contrast/edges to find.
 *
 * Also flips on `lowerNodeId`/`shoeNodeId` for whichever workflow template the
 * currently-active women/men poses default to — without that, the Lower
 * Garment / Footwear steps never even render (gated on the selected pose's
 * effective workflow exposing those nodes), no matter how many catalog items
 * exist. Local-dev-only: these are seed/demo workflow templates with no real
 * ComfyUI jsonContent, not anything wired to production.
 *
 * Idempotent: re-running regenerates the same items' images in place (same
 * r2Key/thumbnailKey, same catalog_item id) rather than duplicating rows; the
 * workflow-template node-id patch only fills in columns that are currently
 * null, never overwrites a real value.
 *
 * Usage: pnpm seed:catalog-lower-shoe-demo
 */
import { randomUUID } from 'node:crypto';
import { createDb, eq, inArray, schema, sql } from '@aivastra/db';
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

const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#22c55e',
  '#f59e0b',
  '#0ea5e9',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
];
function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length];
}
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A simple filled trouser shape: waistband + two legs with a crotch gap.
function pantsShapeSvg(w: number, h: number, fill: string): string {
  const waistW = w * 0.56;
  const waistH = h * 0.1;
  const waistX = (w - waistW) / 2;
  const waistY = h * 0.12;
  const legW = waistW * 0.4;
  const legH = h * 0.62;
  const legY = waistY + waistH - 2;
  const leg1X = waistX;
  const leg2X = waistX + waistW - legW;
  return `
    <rect x="${waistX}" y="${waistY}" width="${waistW}" height="${waistH}" rx="6" fill="${fill}"/>
    <rect x="${leg1X}" y="${legY}" width="${legW}" height="${legH}" rx="8" fill="${fill}"/>
    <rect x="${leg2X}" y="${legY}" width="${legW}" height="${legH}" rx="8" fill="${fill}"/>
  `;
}

// A simple filled shoe side-profile shape.
function shoeShapeSvg(w: number, h: number, fill: string): string {
  const y = h * 0.55;
  return `
    <path d="M ${w * 0.12} ${y + h * 0.18}
      Q ${w * 0.1} ${y - h * 0.08} ${w * 0.3} ${y - h * 0.1}
      L ${w * 0.52} ${y - h * 0.22}
      Q ${w * 0.64} ${y - h * 0.28} ${w * 0.72} ${y - h * 0.14}
      L ${w * 0.84} ${y + h * 0.02}
      Q ${w * 0.94} ${y + h * 0.06} ${w * 0.9} ${y + h * 0.18}
      Z" fill="${fill}"/>
  `;
}

// Filled garment-shape thumbnail (not a flat color swatch — see file header
// for why a real foreground shape matters for ComfyUI's garment-segmentation
// step) with a plain light background and the label underneath, mimicking a
// simple flat-lay product photo closely enough for segmentation to find a
// real foreground region.
async function garmentShapeJpeg(
  width: number,
  height: number,
  kind: 'lower' | 'shoe',
  fillHex: string,
  label: string,
): Promise<Buffer> {
  const shape =
    kind === 'lower' ? pantsShapeSvg(width, height, fillHex) : shoeShapeSvg(width, height, fillHex);
  const fontSize = Math.round(width / 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#f1f1f4"/>
    ${shape}
    <text x="50%" y="${height * 0.92}" font-family="sans-serif" font-size="${fontSize}" fill="#3a3a44"
      text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
async function upload(key: string, buf: Buffer): Promise<void> {
  await storage.putObject(key, buf, 'image/jpeg');
}

// genderSlug must be set — /v1/catalog/:type filters with a strict equality
// match against the requested gender (NULL never matches 'women'/'men'), so a
// demo item with no gender is invisible from either Studio or Fabric to
// Garment regardless of how much else is wired up correctly.
const LOWER_LABELS: Record<'women' | 'men', string[]> = {
  women: ['[demo] Denim Jeans', '[demo] Palazzo Pants', '[demo] Pleated Skirt'],
  men: ['[demo] Chino Pants', '[demo] Denim Jeans (Men)'],
};
const SHOE_LABELS: Record<'women' | 'men', string[]> = {
  women: ['[demo] White Sneakers', '[demo] Block Heels', '[demo] Loafers'],
  men: ['[demo] White Sneakers (Men)', '[demo] Formal Shoes'],
};

async function seedItems(
  type: 'lower' | 'shoe',
  gender: 'women' | 'men',
  labels: string[],
  categorySlug: string,
): Promise<void> {
  const existingRows = await db
    .select({
      id: schema.catalogItems.id,
      label: schema.catalogItems.label,
      r2Key: schema.catalogItems.r2Key,
      thumbnailKey: schema.catalogItems.thumbnailKey,
    })
    .from(schema.catalogItems)
    .where(
      sql`${schema.catalogItems.type} = ${type} and ${schema.catalogItems.genderSlug} = ${gender} and ${schema.catalogItems.label} like '[demo]%'`,
    );
  const existingByLabel = new Map(existingRows.map((r) => [r.label, r]));

  const [category] = await db
    .select({ id: schema.catalogCategories.id })
    .from(schema.catalogCategories)
    .where(eq(schema.catalogCategories.slug, categorySlug));
  if (!category) {
    console.error(`  ${type}/${gender}: category slug "${categorySlug}" not found, skipping`);
    return;
  }
  console.log(
    `  ${type}/${gender}: writing ${labels.length} demo item shapes under "${categorySlug}"...`,
  );
  for (const [i, label] of labels.entries()) {
    const existing = existingByLabel.get(label);
    const id = existing?.id ?? randomUUID();
    const r2Key = existing?.r2Key ?? keys.catalogItem(type, id);
    const thumbnailKey = existing?.thumbnailKey ?? keys.catalogThumb(type, id);
    const buf = await garmentShapeJpeg(480, 480, type, colorFor(i), label.replace('[demo] ', ''));
    await upload(r2Key, buf);
    await upload(thumbnailKey, buf);
    if (existing) continue; // image regenerated in place; row already correct
    await db.insert(schema.catalogItems).values({
      id,
      categoryId: category.id,
      type,
      genderSlug: gender,
      label,
      r2Key,
      thumbnailKey,
      isActive: true,
      sortOrder: i,
    });
  }
}

// Workflow templates currently backing the active women/men poses used by the
// fabric-to-garment / Studio flows during this session, found via psql
// inspection — their lowerNodeId/shoeNodeId are null, which is what actually
// hides the Lower Garment / Footwear steps regardless of catalog item data.
const TEMPLATE_LABELS_TO_PATCH = ['longfrock_28_09_2026', 'full_sleeve_t_shirt_31_08_2026'];

async function patchWorkflowTemplateNodeIds(): Promise<void> {
  const templates = await db
    .select({
      id: schema.workflowTemplates.id,
      label: schema.workflowTemplates.label,
      lowerNodeId: schema.workflowTemplates.lowerNodeId,
      shoeNodeId: schema.workflowTemplates.shoeNodeId,
    })
    .from(schema.workflowTemplates)
    .where(inArray(schema.workflowTemplates.label, TEMPLATE_LABELS_TO_PATCH));
  for (const t of templates) {
    if (t.lowerNodeId && t.shoeNodeId) {
      console.log(`  workflow template "${t.label}": already has lower/shoe node ids, skipping`);
      continue;
    }
    console.log(`  workflow template "${t.label}": setting lowerNodeId/shoeNodeId...`);
    await db
      .update(schema.workflowTemplates)
      .set({
        lowerNodeId: t.lowerNodeId ?? 'lower',
        shoeNodeId: t.shoeNodeId ?? 'shoe',
      })
      .where(eq(schema.workflowTemplates.id, t.id));
  }
}

async function main() {
  console.log('Seeding demo lower/shoe catalog items + enabling pose lower/shoe support...');
  await seedItems('lower', 'women', LOWER_LABELS.women, 'women-lower');
  await seedItems('lower', 'men', LOWER_LABELS.men, 'men-lower');
  await seedItems('shoe', 'women', SHOE_LABELS.women, 'women-shoe');
  await seedItems('shoe', 'men', SHOE_LABELS.men, 'men-shoe');
  await patchWorkflowTemplateNodeIds();
  console.log('✅ Done. Reload the fabric-to-garment / Studio page and select a pose.');
  await close();
}

main().catch((err) => {
  console.error('❌ Seeding demo lower/shoe catalog data failed:', err);
  process.exit(1);
});
