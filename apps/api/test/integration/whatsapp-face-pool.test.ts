import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngineDeps } from '../../src/modules/messaging/deps';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// The bot draws the run's model face from the studio's own face list. A type
// with no face mapping shows every live face of the gender; once a mapping
// exists only mapped faces count, and a switched-off or deleted face never does.
describe('whatsapp face pool', () => {
  let c: Containers;
  let app: TestApp;
  let ids: {
    open: string;
    mapped: string;
    liveA: string;
    liveB: string;
    off: string;
    deleted: string;
  };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { WEB_URL: 'http://localhost:3000' });
    const sfx = `${Date.now()}`;
    const face = async (label: string, extra: { isActive?: boolean; deletedAt?: Date } = {}) =>
      (
        await app.db
          .insert(schema.modelFaces)
          .values({
            gender: 'women',
            label: `${label}-${sfx}`,
            r2Key: `face-${label}-${sfx}.jpg`,
            thumbnailKey: `face-${label}-${sfx}-t.jpg`,
            ...extra,
          })
          .returning()
      )[0].id;
    const liveA = await face('a');
    const liveB = await face('b');
    const off = await face('off', { isActive: false });
    const deleted = await face('deleted', { deletedAt: new Date() });
    const type = async (label: string) =>
      (
        await app.db
          .insert(schema.garmentSubcategories)
          .values({ genderSlug: 'women', slug: `face-${label}-${sfx}`, label })
          .returning()
      )[0].id;
    const open = await type('open');
    const mapped = await type('mapped');
    // Mapped to one live face, the switched-off one and the deleted one.
    await app.db
      .insert(schema.modelFaceSubcategories)
      .values([liveA, off, deleted].map((faceId) => ({ faceId, subcategoryId: mapped })));
    ids = { open, mapped, liveA, liveB, off, deleted };
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('a type with no mapping offers every live face, never an off or deleted one', async () => {
    const got = await createEngineDeps(app).listFaceIds('women', ids.open);
    expect(got).toContain(ids.liveA);
    expect(got).toContain(ids.liveB);
    expect(got).not.toContain(ids.off);
    expect(got).not.toContain(ids.deleted);
  });

  it('a mapped type offers only its live mapped faces', async () => {
    expect(await createEngineDeps(app).listFaceIds('women', ids.mapped)).toEqual([ids.liveA]);
  });
});

// The bot's background pool: admin-flagged backgrounds win once any exist; none
// flagged keeps every studio background.
describe('whatsapp background pool', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { WEB_URL: 'http://localhost:3000' });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const bg = async (label: string, extra: Partial<typeof schema.modelBackgrounds.$inferInsert>) =>
    (
      await app.db
        .insert(schema.modelBackgrounds)
        .values({
          label: `${label}-${Date.now()}`,
          r2Key: `bg-${label}.jpg`,
          thumbnailKey: `bg-${label}-t.jpg`,
          genderSlug: 'boys',
          ...extra,
        })
        .returning()
    )[0].id;

  it('offers every studio background until one is flagged, then only flagged ones', async () => {
    const plain = await bg('plain', {});
    const flagged = await bg('flagged', { whatsappPool: true });
    const flaggedOff = await bg('flagged-off', { whatsappPool: true, isActive: false });
    const deps = createEngineDeps(app);

    const withFlag = await deps.listBackgroundIds('boys');
    expect(withFlag).toEqual([flagged]);

    await app.db
      .update(schema.modelBackgrounds)
      .set({ whatsappPool: false })
      .where(eq(schema.modelBackgrounds.id, flagged));
    const none = await deps.listBackgroundIds('boys');
    expect(none).toContain(plain);
    expect(none).toContain(flagged);
    expect(none).not.toContain(flaggedOff);
  });
});
