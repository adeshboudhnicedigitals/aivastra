import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import * as schema from '../src/schema/index';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const [face] = await db.insert(schema.modelFaces).values({
      gender: 'men',
      label: 'Test Face',
      r2Key: 'faces/test.jpg',
      thumbnailKey: 'faces/test_thumb.jpg',
    }).returning();

    expect(face.id).toBeTruthy();
    expect(face.gender).toBe('men');
    expect(face.isActive).toBe(true);
  });
});

describe('model_backgrounds', () => {
  it('inserts background linked to a face', async () => {
    const [face] = await db.insert(schema.modelFaces).values({
      gender: 'women',
      label: 'Women Face',
      r2Key: 'faces/w1.jpg',
      thumbnailKey: 'faces/w1_thumb.jpg',
    }).returning();

    const [bg] = await db.insert(schema.modelBackgrounds).values({
      faceId: face.id,
      label: 'Studio White',
      r2Key: 'backgrounds/w1_studio.jpg',
      thumbnailKey: 'backgrounds/w1_studio_thumb.jpg',
    }).returning();

    expect(bg.faceId).toBe(face.id);
  });

  it('rejects background with non-existent face_id', async () => {
    await expect(
      db.insert(schema.modelBackgrounds).values({
        faceId: '00000000-0000-0000-0000-000000000000',
        label: 'Bad',
        r2Key: 'x',
        thumbnailKey: 'x',
      })
    ).rejects.toThrow();
  });
});

describe('model_poses', () => {
  it('inserts pose linked to background with flags', async () => {
    const [face] = await db.insert(schema.modelFaces).values({
      gender: 'men',
      label: 'Men Face 2',
      r2Key: 'faces/m2.jpg',
      thumbnailKey: 'faces/m2_thumb.jpg',
    }).returning();

    const [bg] = await db.insert(schema.modelBackgrounds).values({
      faceId: face.id,
      label: 'Outdoor',
      r2Key: 'backgrounds/m2_outdoor.jpg',
      thumbnailKey: 'backgrounds/m2_outdoor_thumb.jpg',
    }).returning();

    const [pose] = await db.insert(schema.modelPoses).values({
      backgroundId: bg.id,
      label: 'Standing front',
      r2Key: 'poses/m2_outdoor_front.jpg',
      thumbnailKey: 'poses/m2_outdoor_front_thumb.jpg',
      showsLower: true,
      showsShoes: true,
    }).returning();

    expect(pose.backgroundId).toBe(bg.id);
    expect(pose.showsLower).toBe(true);
    expect(pose.showsShoes).toBe(true);
  });

  it('defaults showsLower and showsShoes to false', async () => {
    const [face] = await db.insert(schema.modelFaces).values({
      gender: 'boys',
      label: 'Boys Face 1',
      r2Key: 'faces/b1.jpg',
      thumbnailKey: 'faces/b1_thumb.jpg',
    }).returning();

    const [bg] = await db.insert(schema.modelBackgrounds).values({
      faceId: face.id,
      label: 'Indoor',
      r2Key: 'backgrounds/b1_indoor.jpg',
      thumbnailKey: 'backgrounds/b1_indoor_thumb.jpg',
    }).returning();

    const [pose] = await db.insert(schema.modelPoses).values({
      backgroundId: bg.id,
      label: 'Half body',
      r2Key: 'poses/b1_indoor_half.jpg',
      thumbnailKey: 'poses/b1_indoor_half_thumb.jpg',
    }).returning();

    expect(pose.showsLower).toBe(false);
    expect(pose.showsShoes).toBe(false);
  });
});
