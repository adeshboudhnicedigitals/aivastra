/**
 * One-shot data migration: copy faceSideR2Key and bgComfyR2Key from model_pose_assets
 * to model_faces and model_backgrounds respectively.
 *
 * Run AFTER migration 0046 is applied and BEFORE deploying the new API/dispatcher code.
 *
 * Usage: pnpm tsx scripts/migrate-face-bg-keys.ts [--dry-run]
 */
import { createDb } from '@aivastra/db';
import * as schema from '@aivastra/db/schema';
import { and, isNotNull, sql } from 'drizzle-orm';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const db = createDb(process.env.DATABASE_URL!);

  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  // ── 1. Copy faceSideR2Key from model_pose_assets → model_faces ─────────────
  // For each face: take the most recently created pose asset that has a faceSideR2Key.
  const faceRows = await db.execute<{
    face_id: string;
    face_side_r2_key: string;
  }>(sql`
    SELECT DISTINCT ON (face_id)
      face_id,
      face_side_r2_key
    FROM model_pose_assets
    WHERE face_id IS NOT NULL
      AND face_side_r2_key IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY face_id, created_at DESC
  `);

  console.log(`Faces to update: ${faceRows.rows.length}`);
  let faceUpdated = 0;
  let faceSkipped = 0;

  for (const row of faceRows.rows) {
    const [existing] = await db
      .select({ faceSideR2Key: schema.modelFaces.faceSideR2Key })
      .from(schema.modelFaces)
      .where(sql`id = ${row.face_id}`);

    if (existing?.faceSideR2Key) {
      console.log(`  SKIP face ${row.face_id} — already has faceSideR2Key`);
      faceSkipped++;
      continue;
    }

    console.log(`  UPDATE face ${row.face_id} → ${row.face_side_r2_key}`);
    if (!isDryRun) {
      await db.execute(
        sql`UPDATE model_faces SET face_side_r2_key = ${row.face_side_r2_key}, updated_at = NOW() WHERE id = ${row.face_id}`,
      );
    }
    faceUpdated++;
  }

  // ── 2. Copy bgComfyR2Key from model_pose_assets → model_backgrounds ────────
  const bgRows = await db.execute<{
    background_id: string;
    bg_comfy_r2_key: string;
  }>(sql`
    SELECT DISTINCT ON (background_id)
      background_id,
      bg_comfy_r2_key
    FROM model_pose_assets
    WHERE background_id IS NOT NULL
      AND bg_comfy_r2_key IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY background_id, created_at DESC
  `);

  console.log(`\nBackgrounds to update: ${bgRows.rows.length}`);
  let bgUpdated = 0;
  let bgSkipped = 0;

  for (const row of bgRows.rows) {
    const [existing] = await db
      .select({ bgComfyR2Key: schema.modelBackgrounds.bgComfyR2Key })
      .from(schema.modelBackgrounds)
      .where(sql`id = ${row.background_id}`);

    if (existing?.bgComfyR2Key) {
      console.log(`  SKIP bg ${row.background_id} — already has bgComfyR2Key`);
      bgSkipped++;
      continue;
    }

    console.log(`  UPDATE bg ${row.background_id} → ${row.bg_comfy_r2_key}`);
    if (!isDryRun) {
      await db.execute(
        sql`UPDATE model_backgrounds SET bg_comfy_r2_key = ${row.bg_comfy_r2_key}, updated_at = NOW() WHERE id = ${row.background_id}`,
      );
    }
    bgUpdated++;
  }

  // ── 3. Audit: flag active faces/bgs still missing their ComfyUI keys ───────
  const facesWithoutKey = await db
    .select({ id: schema.modelFaces.id, label: schema.modelFaces.label })
    .from(schema.modelFaces)
    .where(
      and(
        isNotNull(schema.modelFaces.isActive),
        sql`${schema.modelFaces.isActive} = true`,
        sql`${schema.modelFaces.faceSideR2Key} IS NULL`,
        sql`${schema.modelFaces.deletedAt} IS NULL`,
      ),
    );

  const bgsWithoutKey = await db
    .select({ id: schema.modelBackgrounds.id, label: schema.modelBackgrounds.label })
    .from(schema.modelBackgrounds)
    .where(
      and(
        sql`${schema.modelBackgrounds.isActive} = true`,
        sql`${schema.modelBackgrounds.bgComfyR2Key} IS NULL`,
        sql`${schema.modelBackgrounds.deletedAt} IS NULL`,
      ),
    );

  console.log('\n── Summary ─────────────────────────────────────────────────');
  console.log(`Faces updated: ${faceUpdated}, skipped: ${faceSkipped}`);
  console.log(`Backgrounds updated: ${bgUpdated}, skipped: ${bgSkipped}`);

  if (facesWithoutKey.length > 0) {
    console.warn(`\n⚠  ${facesWithoutKey.length} active face(s) still missing faceSideR2Key:`);
    for (const f of facesWithoutKey) console.warn(`   ${f.id}  ${f.label}`);
    console.warn('   → Upload a ComfyUI face image for these faces in the admin panel.');
  }

  if (bgsWithoutKey.length > 0) {
    console.warn(`\n⚠  ${bgsWithoutKey.length} active background(s) still missing bgComfyR2Key:`);
    for (const b of bgsWithoutKey) console.warn(`   ${b.id}  ${b.label}`);
    console.warn(
      '   → Upload a ComfyUI background image for these backgrounds in the admin panel.',
    );
  }

  if (facesWithoutKey.length === 0 && bgsWithoutKey.length === 0) {
    console.log('✓  All active faces and backgrounds have their ComfyUI keys.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
