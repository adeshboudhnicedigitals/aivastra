import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /v1/models/faces', () => {
  let containers: Containers;
  let app: TestApp;

  beforeAll(async () => {
    containers = await startContainers();
    app = await buildTestApp(containers);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await containers?.stop();
  });

  // Register + verify + login, returning an access token — same pattern as
  // apps/api/test/integration/catalogue-templates-public.test.ts's loginToken helper.
  async function loginToken(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName: 'T', email, password: 'password123' },
    });
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json().accessToken as string;
  }

  it('includes tags in the response', async () => {
    await app.db.insert(schema.modelFaces).values({
      gender: 'men',
      label: 'Tagged Face',
      r2Key: 'test/face.jpg',
      thumbnailKey: 'test/face.thumb.jpg',
      tags: ['warm tone', 'closeup'],
    });

    const accessToken = await loginToken(`face-tags-${Date.now()}@x.com`);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/faces?gender=men',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { label: string; tags: string[] }[];
    const found = items.find((i) => i.label === 'Tagged Face');
    expect(found?.tags).toEqual(['warm tone', 'closeup']);
  });

  it('opt-in-once-explicit: no mapping row shows every active face, one mapping row narrows to just that face', async () => {
    const sfx = Date.now() + 1;
    const [faceA] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Mapping Face A ${sfx}`,
        r2Key: `test/face-a-${sfx}.jpg`,
        thumbnailKey: `test/face-a-thumb-${sfx}.jpg`,
      })
      .returning();
    const [faceB] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Mapping Face B ${sfx}`,
        r2Key: `test/face-b-${sfx}.jpg`,
        thumbnailKey: `test/face-b-thumb-${sfx}.jpg`,
      })
      .returning();
    if (!faceA || !faceB) throw new Error('faces not created');
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `face-optin-gt-${sfx}`, label: 'Face opt-in' })
      .returning();
    if (!garmentType) throw new Error('garment type not created');

    const accessToken = await loginToken(`face-optin-${sfx}@x.com`);
    const auth = { authorization: `Bearer ${accessToken}` };

    // No explicit mapping yet -> opt-out, every active face of the gender shows.
    const beforeRes = await app.inject({
      method: 'GET',
      url: `/v1/models/faces?gender=women&garmentTypeId=${garmentType.id}`,
      headers: auth,
    });
    const beforeIds = (beforeRes.json().items as { id: string }[]).map((i) => i.id);
    expect(beforeIds).toContain(faceA.id);
    expect(beforeIds).toContain(faceB.id);

    // Explicitly map only faceA -> narrows to just that face for this garment type.
    await app.db
      .insert(schema.modelFaceSubcategories)
      .values({ faceId: faceA.id, subcategoryId: garmentType.id });

    const afterRes = await app.inject({
      method: 'GET',
      url: `/v1/models/faces?gender=women&garmentTypeId=${garmentType.id}`,
      headers: auth,
    });
    const afterIds = (afterRes.json().items as { id: string }[]).map((i) => i.id);
    expect(afterIds).toContain(faceA.id);
    expect(afterIds).not.toContain(faceB.id);

    // Without a garmentTypeId, opt-in doesn't apply -> both faces still show.
    const noTypeRes = await app.inject({
      method: 'GET',
      url: '/v1/models/faces?gender=women',
      headers: auth,
    });
    const noTypeIds = (noTypeRes.json().items as { id: string }[]).map((i) => i.id);
    expect(noTypeIds).toContain(faceA.id);
    expect(noTypeIds).toContain(faceB.id);
  });
});
