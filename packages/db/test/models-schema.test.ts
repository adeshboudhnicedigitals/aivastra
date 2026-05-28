import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/schema/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;
let db: ReturnType<typeof drizzle>;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  sql = postgres(container.getConnectionUri());
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '../src/migrations') });
}, 60_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

describe('model_faces', () => {
  it('inserts and retrieves a face', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'Test Face',
        r2Key: 'faces/test.jpg',
        thumbnailKey: 'faces/test_thumb.jpg',
      })
      .returning();

    expect(face.id).toBeTruthy();
    expect(face.gender).toBe('men');
    expect(face.isActive).toBe(true);
  });
});

describe('model_backgrounds (global)', () => {
  it('inserts background without faceId', async () => {
    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Studio White',
        r2Key: 'backgrounds/studio_white.jpg',
        thumbnailKey: 'backgrounds/studio_white_thumb.jpg',
      })
      .returning();

    expect(bg.id).toBeTruthy();
    expect(bg.label).toBe('Studio White');
    // no faceId column
    expect((bg as unknown as Record<string, unknown>).faceId).toBeUndefined();
  });
});

describe('garment_subcategories', () => {
  it('inserts a garment subcategory', async () => {
    const [sub] = await db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'men',
        slug: 'fullsleeveshirt',
        label: 'Full Sleeve Shirt',
      })
      .returning();

    expect(sub.id).toBeTruthy();
    expect(sub.genderSlug).toBe('men');
    expect(sub.slug).toBe('fullsleeveshirt');
    expect(sub.isActive).toBe(true);
  });
});

describe('model_poses (per subcategory × face × background)', () => {
  it('inserts pose linked to subcategory + face + background', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'Pose Face',
        r2Key: 'faces/pose_face.jpg',
        thumbnailKey: 'faces/pose_face_thumb.jpg',
      })
      .returning();

    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Pose BG',
        r2Key: 'backgrounds/pose_bg.jpg',
        thumbnailKey: 'backgrounds/pose_bg_thumb.jpg',
      })
      .returning();

    const [sub] = await db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'men',
        slug: 'tshirt',
        label: 'T-Shirt',
      })
      .returning();

    const [pose] = await db
      .insert(schema.modelPoses)
      .values({
        subcategoryId: sub.id,
        faceId: face.id,
        backgroundId: bg.id,
        label: 'm1bg1p1',
        r2Key: 'poses/m1bg1p1.jpg',
        thumbnailKey: 'poses/m1bg1p1_thumb.jpg',
        showsLower: true,
        showsShoes: false,
      })
      .returning();

    expect(pose.subcategoryId).toBe(sub.id);
    expect(pose.faceId).toBe(face.id);
    expect(pose.backgroundId).toBe(bg.id);
    expect(pose.showsLower).toBe(true);
    expect(pose.showsShoes).toBe(false);
  });

  it('rejects pose with non-existent subcategory_id', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: 'FK Test Face',
        r2Key: 'faces/fk_test.jpg',
        thumbnailKey: 'faces/fk_test_thumb.jpg',
      })
      .returning();

    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'FK Test BG',
        r2Key: 'backgrounds/fk_test.jpg',
        thumbnailKey: 'backgrounds/fk_test_thumb.jpg',
      })
      .returning();

    await expect(
      db.insert(schema.modelPoses).values({
        subcategoryId: '00000000-0000-0000-0000-000000000000',
        faceId: face.id,
        backgroundId: bg.id,
        label: 'Bad',
        r2Key: 'x',
        thumbnailKey: 'x',
      }),
    ).rejects.toThrow();
  });

  it('rejects pose with non-existent face_id', async () => {
    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'FK BG 2',
        r2Key: 'backgrounds/fk2.jpg',
        thumbnailKey: 'backgrounds/fk2_thumb.jpg',
      })
      .returning();

    const [sub] = await db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'men',
        slug: 'hoodie',
        label: 'Hoodie',
      })
      .returning();

    await expect(
      db.insert(schema.modelPoses).values({
        subcategoryId: sub.id,
        faceId: '00000000-0000-0000-0000-000000000000',
        backgroundId: bg.id,
        label: 'Bad',
        r2Key: 'x',
        thumbnailKey: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('subcategory_templates', () => {
  it('inserts a template for subcategory × face × background', async () => {
    const [face] = await db
      .insert(schema.modelFaces)
      .values({
        gender: 'men',
        label: 'Template Face',
        r2Key: 'faces/tmpl.jpg',
        thumbnailKey: 'faces/tmpl_thumb.jpg',
      })
      .returning();

    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Outdoor',
        r2Key: 'backgrounds/outdoor.jpg',
        thumbnailKey: 'backgrounds/outdoor_thumb.jpg',
      })
      .returning();

    const [sub] = await db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'men',
        slug: 'polo',
        label: 'Polo Shirt',
      })
      .returning();

    const [tmpl] = await db
      .insert(schema.subcategoryTemplates)
      .values({
        subcategoryId: sub.id,
        faceId: face.id,
        backgroundId: bg.id,
        r2Key: 'templates/polo_tmpl1_bg1.jpg',
        thumbnailKey: 'templates/polo_tmpl1_bg1_thumb.jpg',
      })
      .returning();

    expect(tmpl.subcategoryId).toBe(sub.id);
    expect(tmpl.faceId).toBe(face.id);
    expect(tmpl.backgroundId).toBe(bg.id);
    expect(tmpl.isActive).toBe(true);
  });

  it('rejects template with non-existent face_id', async () => {
    const [bg] = await db
      .insert(schema.modelBackgrounds)
      .values({
        label: 'Test BG',
        r2Key: 'backgrounds/test.jpg',
        thumbnailKey: 'backgrounds/test_thumb.jpg',
      })
      .returning();

    const [sub] = await db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: 'dress',
        label: 'Dress',
      })
      .returning();

    await expect(
      db.insert(schema.subcategoryTemplates).values({
        subcategoryId: sub.id,
        faceId: '00000000-0000-0000-0000-000000000000',
        backgroundId: bg.id,
        r2Key: 'templates/bad.jpg',
        thumbnailKey: 'templates/bad_thumb.jpg',
      }),
    ).rejects.toThrow();
  });
});
