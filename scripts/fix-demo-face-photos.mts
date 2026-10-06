/**
 * Replace the flat, text-label placeholder images on every demo `model_faces`
 * row (the ones seeded by scripts/seed-admin-demo-data.mts — "Vivaan (men)",
 * "Meera (men)", "Aditi (women)", etc.) with a real photographic face.
 *
 * Root cause this fixes: ComfyUI's `/prompt` dispatch was failing with
 * "Bounded Image Crop with Mask (node 651:620): index is out of bounds for
 * dimension with size 0" on every local tryon/fabric-to-shoot generation.
 * That node is NOT related to the lower/shoe garment steps (an earlier,
 * wrong theory this session chased by regenerating catalog item thumbnails,
 * which had no effect). Tracing workflow_templates.jsonContent showed node
 * 651:620 sits downstream of `651:749 ClothesSegment` ("Clothing Segmentation
 * (RMBG)", configured with Face/Hair/Hat/Sunglasses=true), which reads from
 * `615 LoadImage` titled "face" — i.e. this whole subgraph parses the
 * uploaded FACE photo to crop out just the face/hair region. Fed a flat
 * solid-color placeholder (confirmed: downloaded and inspected
 * models/faces/b078f8c2-....jpg, b078f8c2 = "Vivaan (men)" — it's a plain
 * `#6366f1` rectangle reading "Face 1"), the human-face segmentation model
 * finds no face, so the mask comes back empty and the crop node throws
 * exactly this error.
 *
 * `model_faces` already has one genuinely real photo — "test-model" (women,
 * id 69589231-37d7-483f-89a9-6765e1144d8d, r2Key
 * models/faces/797ef6d3-....jpg, a real 1254x1254 headshot, 2.4MB). This
 * script reads that real photo via the storage provider and writes a
 * 480x720 cover-cropped copy of it over every other (placeholder) face
 * row's r2Key/thumbnailKey, so the segmentation step has real face/hair
 * pixels to work with. It intentionally does NOT touch DB rows (same ids,
 * same keys, same labels) — only the image bytes change, so every job that
 * already references these face ids keeps working, just with a real photo
 * now. The gender/name labels stay mismatched from the one real photo's
 * actual appearance; this is local-dev test data, not a production catalog
 * — flag this to a human if gender-accurate demo photos are ever needed.
 *
 * Idempotent: always re-renders (cheap, no DB writes), safe to re-run.
 *
 * Usage: pnpm fix:demo-face-photos
 */
import { createDb, eq, ne, schema } from '@aivastra/db';
import { createR2Provider } from '@aivastra/storage';
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

const REAL_PHOTO_FACE_ID = '69589231-37d7-483f-89a9-6765e1144d8d'; // "test-model"

async function main() {
  const [realFace] = await db
    .select({ r2Key: schema.modelFaces.r2Key })
    .from(schema.modelFaces)
    .where(eq(schema.modelFaces.id, REAL_PHOTO_FACE_ID));
  if (!realFace) {
    console.error(`Reference real-photo face row ${REAL_PHOTO_FACE_ID} not found, aborting.`);
    process.exit(1);
  }
  console.log(`Reading real reference photo from ${realFace.r2Key}...`);
  const sourceBytes = await storage.getObject(realFace.r2Key);
  const resized = await sharp(sourceBytes)
    .resize(480, 720, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 90 })
    .toBuffer();

  const placeholders = await db
    .select({ id: schema.modelFaces.id, label: schema.modelFaces.label, r2Key: schema.modelFaces.r2Key, thumbnailKey: schema.modelFaces.thumbnailKey })
    .from(schema.modelFaces)
    .where(ne(schema.modelFaces.id, REAL_PHOTO_FACE_ID));

  console.log(`Overwriting ${placeholders.length} placeholder face image(s) with the real photo...`);
  for (const p of placeholders) {
    await storage.putObject(p.r2Key, resized, 'image/jpeg');
    await storage.putObject(p.thumbnailKey, resized, 'image/jpeg');
    console.log(`  ${p.label} (${p.id}) — done`);
  }
  console.log('✅ Done. Retry the tryon/fabric-to-shoot generation.');
  await close();
}

main().catch((err) => {
  console.error('❌ Fixing demo face photos failed:', err);
  process.exit(1);
});
