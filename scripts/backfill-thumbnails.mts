/**
 * Regenerate REAL (small) thumbnails for admin-curated assets.
 *
 * Thumbnail infra already exists (thumbnail_key columns + *.thumb.jpg keys), but the
 * stored thumb objects are full-size copies — nothing ever resized them. This script
 * reads each full image, downscales it with sharp, and overwrites ONLY the thumb key.
 *
 * SAFETY: never writes r2_key / face_side_r2_key / bg_comfy_r2_key, never writes the DB.
 *         Missing/unreadable source objects are skipped + logged (re-upload those).
 *         Idempotent + re-runnable (withoutEnlargement → no-op once small enough).
 *
 * Usage (run on the VPS where MinIO binds 127.0.0.1, with the prod .env loaded):
 *   DRY_RUN=1 pnpm tsx scripts/backfill-thumbnails.ts        # log only, no writes
 *   pnpm tsx scripts/backfill-thumbnails.ts                  # real run
 *   ONLY=poses,faces pnpm tsx scripts/backfill-thumbnails.ts # subset of tables
 *
 * Requires env: DATABASE_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *               R2_BUCKET, (optional) R2_FORCE_PATH_STYLE (default true).
 */

import { createDb, schema } from '@aivastra/db';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const THUMB_MAX = 512;
const THUMB_QUALITY = 78;

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const ONLY = (process.env.ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const BUCKET = requireEnv('R2_BUCKET');

const s3 = new S3Client({
  endpoint: requireEnv('R2_ENDPOINT'),
  region: 'auto',
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== 'false',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

/** Each table maps source-key column → destination (thumb) key column. */
interface TableSpec {
  name: string;
  // returns rows of { id, src, dst } — src may be undefined/null (skip)
  load: (
    db: ReturnType<typeof createDb>['db'],
  ) => Promise<{ id: string; src: string | null; dst: string | null }[]>;
}

const SPECS: TableSpec[] = [
  {
    name: 'faces',
    load: async (db) =>
      (await db.select().from(schema.modelFaces)).map((r) => ({
        id: r.id,
        src: r.r2Key,
        dst: r.thumbnailKey,
      })),
  },
  {
    name: 'backgrounds',
    load: async (db) =>
      (await db.select().from(schema.modelBackgrounds)).map((r) => ({
        id: r.id,
        src: r.r2Key,
        dst: r.thumbnailKey,
      })),
  },
  {
    name: 'poses',
    load: async (db) =>
      (await db.select().from(schema.modelPoses)).map((r) => ({
        id: r.id,
        src: r.r2Key,
        dst: r.thumbnailKey,
      })),
  },
  {
    name: 'catalog',
    load: async (db) =>
      (await db.select().from(schema.catalogItems)).map((r) => ({
        id: r.id,
        src: r.r2Key,
        dst: r.thumbnailKey,
      })),
  },
  {
    // No full key exists for subcategories — the thumb key IS the only image.
    // Resize in place; withoutEnlargement keeps it idempotent.
    name: 'subcategories',
    load: async (db) =>
      (await db.select().from(schema.garmentSubcategories)).map((r) => ({
        id: r.id,
        src: r.thumbnailKey,
        dst: r.thumbnailKey,
      })),
  },
];

async function getObjectBytes(key: string): Promise<Buffer> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!obj.Body) throw new Error('empty body');
  const bytes = await obj.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function processTable(spec: TableSpec, db: ReturnType<typeof createDb>['db']) {
  const rows = await spec.load(db);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.src || !row.dst) {
      skipped++;
      continue;
    }
    try {
      const full = await getObjectBytes(row.src);
      const thumb = await sharp(full)
        .rotate()
        .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
        .toBuffer();

      if (DRY_RUN) {
        console.log(
          `[dry] ${spec.name} ${row.id}: ${row.src} (${(full.length / 1024).toFixed(0)}KB) -> ${row.dst} (${(thumb.length / 1024).toFixed(0)}KB)`,
        );
      } else {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: row.dst,
            Body: thumb,
            ContentType: 'image/jpeg',
          }),
        );
      }
      ok++;
    } catch (err) {
      failed++;
      console.warn(
        `[skip] ${spec.name} ${row.id}: ${row.src} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `${spec.name}: ${ok} ok, ${skipped} skipped (no key), ${failed} failed (${rows.length} total)`,
  );
  return { ok, skipped, failed };
}

async function main() {
  const { db, close } = createDb(DATABASE_URL);
  const specs = ONLY.length ? SPECS.filter((s) => ONLY.includes(s.name)) : SPECS;

  console.log(
    `${DRY_RUN ? 'DRY RUN — ' : ''}backfilling thumbnails (max ${THUMB_MAX}px, q${THUMB_QUALITY}) for: ${specs.map((s) => s.name).join(', ')}`,
  );

  const totals = { ok: 0, skipped: 0, failed: 0 };
  try {
    for (const spec of specs) {
      const r = await processTable(spec, db);
      totals.ok += r.ok;
      totals.skipped += r.skipped;
      totals.failed += r.failed;
    }
  } finally {
    await close();
  }

  console.log(
    `\nDONE${DRY_RUN ? ' (dry run — nothing written)' : ''}: ${totals.ok} ok, ${totals.skipped} skipped, ${totals.failed} failed`,
  );
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
