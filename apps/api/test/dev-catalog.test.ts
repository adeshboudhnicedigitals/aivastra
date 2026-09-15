import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bumpCatalogOptionsVersion } from '../src/lib/catalog-options-cache.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestApiKey, createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let key: string;
let merchantId: string;
let userId: string;
let setCredits: (n: number) => Promise<void>;

// Ids of the assets published to the public API, for asserting they are NEVER leaked.
let publishedFaceId: string;
let hiddenFaceId: string;

// A composite garment type (kurta+pyjama-style) requiring the caller's own 2nd
// piece photo — exercises the lowerGarment/thirdGarment upload path.
let compositeGarmentTypeId: string;

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

const getOptions = (query: string, token = key, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/dev/catalog/options?${query}`, {
    headers: { authorization: `Bearer ${token}`, ...headers },
  });

function generateBody(overrides: Record<string, unknown> = {}) {
  return {
    garment: jpegBytes().toString('base64'),
    gender: 'women',
    face: 'women-model-a',
    looks: [{ pose: 'front-standing', background: 'studio-white' }],
    aspectRatio: '3:4',
    resolution: '2K',
    ...overrides,
  };
}

const postGenerate = (body: unknown, token = key) =>
  fetch(`${base}/v1/dev/catalog/generate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const m = await createTestMerchant(app, { balance: 1000 });
  merchantId = m.merchantId;
  userId = m.userId;
  setCredits = m.credits;
  ({ key } = await createTestApiKey(app, merchantId));

  // Published: carries a public_api_slug, so it is visible on /v1/dev/*.
  const [publishedFace] = await app.db
    .insert(schema.modelFaces)
    .values({
      gender: 'women',
      label: 'Model A',
      thumbnailKey: 'f-a-t.jpg',
      r2Key: 'f-a.jpg',
      isActive: true,
      publicApiSlug: 'women-model-a',
    })
    .returning();
  publishedFaceId = publishedFace.id;

  // Unpublished: active and visible to Studio/Shopify, but public_api_slug is null so
  // the developer API must not see it. This is the whole point of the curated subset.
  const [hiddenFace] = await app.db
    .insert(schema.modelFaces)
    .values({
      gender: 'women',
      label: 'Internal Only',
      thumbnailKey: 'f-h-t.jpg',
      r2Key: 'f-h.jpg',
      isActive: true,
      publicApiSlug: null,
    })
    .returning();
  hiddenFaceId = hiddenFace.id;

  await app.db.insert(schema.modelBackgrounds).values({
    label: 'Studio White',
    r2Key: 'bg.jpg',
    thumbnailKey: 'bg-t.jpg',
    bgComfyR2Key: 'bg-comfy.jpg',
    isActive: true,
    scope: 'general',
    publicApiSlug: 'studio-white',
  });

  await app.db.insert(schema.modelBackgrounds).values({
    label: 'Studio Grey',
    r2Key: 'bg2.jpg',
    thumbnailKey: 'bg2-t.jpg',
    bgComfyR2Key: 'bg2-comfy.jpg',
    isActive: true,
    scope: 'general',
    publicApiSlug: 'studio-grey',
  });

  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'dev-catalog-wf',
      label: 'WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: ['1'],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();

  // A SEPARATE workflow template with a real lowerNodeId, used only by the
  // composite-garment-type pose below. createJob requires a lower garment
  // (curated or uploaded) on any pose whose workflow has a lower slot — sharing
  // `wf` above would have made every other pose in this fixture set (which have
  // no lower slot and no lower garment in their test bodies) start failing too.
  const [wfWithLower] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'dev-catalog-wf-lower',
      label: 'WF Lower',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: ['1'],
      lowerNodeId: 'x',
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();

  const [, sideProfile] = await app.db
    .insert(schema.modelPoseAssets)
    .values([
      {
        genderSlug: 'women',
        label: 'Front Standing',
        displayName: 'Front Standing',
        r2Key: 'pose.jpg',
        thumbnailKey: 'pose-t.jpg',
        isActive: true,
        scope: 'general',
        workflowTemplateId: wf.id,
        publicApiSlug: 'front-standing',
      },
      {
        genderSlug: 'women',
        label: 'Side Profile',
        displayName: 'Side Profile',
        r2Key: 'pose2.jpg',
        thumbnailKey: 'pose2-t.jpg',
        isActive: true,
        scope: 'general',
        workflowTemplateId: wf.id,
        publicApiSlug: 'side-profile',
      },
    ])
    .returning();

  // A pose whose workflow HAS a lower slot (wfWithLower), dedicated to the
  // composite-garment-type tests below — createJob requires a lower garment on
  // any pose using this workflow, which is exactly the case those tests cover.
  // Only its public_api_slug ('full-body-with-lower') is referenced below.
  await app.db
    .insert(schema.modelPoseAssets)
    .values({
      genderSlug: 'women',
      label: 'Full Body With Lower',
      displayName: 'Full Body With Lower',
      r2Key: 'pose3.jpg',
      thumbnailKey: 'pose3-t.jpg',
      isActive: true,
      scope: 'general',
      workflowTemplateId: wfWithLower.id,
      publicApiSlug: 'full-body-with-lower',
    })
    .returning();

  // A garment type that disables `side-profile` via a per-(pose, garmentType)
  // override — reproducing the real prod gotcha: a pose visible in the unfiltered
  // /v1/dev/catalog/options list can still be rejected by /generate once a
  // garmentType narrows it out.
  const [dress] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: 'dress',
      label: 'Dress',
      isActive: true,
      publicApiSlug: 'dress',
    })
    .returning();

  await app.db.insert(schema.poseGarmentConfigs).values({
    poseAssetId: sideProfile.id,
    subcategoryId: dress.id,
    isActive: false,
  });

  // A garment type that requires the caller's own 2nd piece photo (mirrors a real
  // kurta-pyjama/sherwani-pyjama config) — same requiresLowerUpload flag
  // EditGarmentTypeModal.tsx already toggles admin-side.
  const [composite] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: 'kurta-pyjama-test',
      label: 'Kurta Pyjama',
      isActive: true,
      publicApiSlug: 'kurta-pyjama-test',
      requiresLowerUpload: true,
      lowerUploadLabel: 'Pyjama photo',
    })
    .returning();
  compositeGarmentTypeId = composite.id;

  // Seeded straight into Postgres, so the /admin/* onResponse hook that normally
  // invalidates never fired — see plugins/catalog-cache-invalidation.ts.
  await bumpCatalogOptionsVersion(app);
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/dev/catalog/options', () => {
  it('requires an API key', async () => {
    const res = await fetch(`${base}/v1/dev/catalog/options?gender=women`);
    expect(res.status).toBe(401);
  });

  it('returns only assets that carry a public_api_slug, and never exposes internal ids', async () => {
    const res = await getOptions('gender=women');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      faces: { slug: string; label: string; thumbnailUrl: string }[];
      backgrounds: { slug: string }[];
      poses: { slug: string; hasLower: boolean; hasShoes: boolean }[];
    };

    expect(body.faces.map((f) => f.slug)).toContain('women-model-a');
    expect(body.faces.some((f) => f.label === 'Internal Only')).toBe(false);
    expect(body.backgrounds.map((b) => b.slug)).toContain('studio-white');
    expect(body.poses.map((p) => p.slug)).toContain('front-standing');

    // No internal UUID may appear anywhere in the public payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(publishedFaceId);
    expect(raw).not.toContain(hiddenFaceId);
  });

  it('serves a repeat request from Redis rather than rebuilding from Postgres', async () => {
    // Warm the cache.
    await getOptions('gender=women');
    const cacheKeys = await app.redis.keys('catalog:options:*:public:women:all');
    expect(cacheKeys.length).toBeGreaterThan(0);

    // Publish a new face directly in Postgres WITHOUT bumping the generation. If the
    // second request still cannot see it, the response demonstrably came from Redis
    // and not from a fresh query. (Production never takes this path — asset writes go
    // through /admin/*, which invalidates.)
    const [sneaked] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: 'Sneaked In',
        thumbnailKey: 'f-s-t.jpg',
        r2Key: 'f-s.jpg',
        isActive: true,
        publicApiSlug: 'women-sneaked-in',
      })
      .returning();

    const cached = (await (await getOptions('gender=women')).json()) as {
      faces: { slug: string }[];
    };
    expect(cached.faces.map((f) => f.slug)).not.toContain('women-sneaked-in');

    // And once the generation is bumped, the same request picks it up.
    await bumpCatalogOptionsVersion(app);
    const fresh = (await (await getOptions('gender=women')).json()) as {
      faces: { slug: string }[];
    };
    expect(fresh.faces.map((f) => f.slug)).toContain('women-sneaked-in');

    // Leave the fixture set as the other tests expect it.
    await app.db.delete(schema.modelFaces).where(eq(schema.modelFaces.id, sneaked.id));
    await bumpCatalogOptionsVersion(app);
  });

  it('returns 304 when If-None-Match matches the current cache generation', async () => {
    const first = await getOptions('gender=women');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await getOptions('gender=women', key, { 'if-none-match': etag as string });
    expect(second.status).toBe(304);
  });

  it('changes its ETag after an admin asset mutation bumps the cache generation', async () => {
    const before = (await getOptions('gender=women')).headers.get('etag');
    await bumpCatalogOptionsVersion(app);
    const after = (await getOptions('gender=women')).headers.get('etag');
    expect(after).not.toBe(before);
  });
});

describe('POST /v1/dev/catalog/generate', () => {
  it('rejects an unknown slug with 400 BAD_SLUG and charges nothing', async () => {
    await setCredits(1000);
    const res = await postGenerate(generateBody({ face: 'no-such-model' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_SLUG');
    expect(body.error.message).toContain('no-such-model');

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits.balance).toBe(1000);
  });

  it('rejects a pose disabled for the given garmentType, naming the garmentType in the message', async () => {
    await setCredits(1000);
    const res = await postGenerate(
      generateBody({
        garmentType: 'dress',
        looks: [{ pose: 'side-profile', background: 'studio-white' }],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_SLUG');
    expect(body.error.message).toContain('garmentType "dress"');

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits.balance).toBe(1000);
  });

  it('rejects a face belonging to a different gender as an unknown slug', async () => {
    const res = await postGenerate(generateBody({ gender: 'men' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_SLUG');
  });

  it('rejects more than 12 looks', async () => {
    const looks = Array.from({ length: 13 }, () => ({
      pose: 'front-standing',
      background: 'studio-white',
    }));
    const res = await postGenerate(generateBody({ looks }));
    expect(res.status).toBe(400);
  });

  it('creates one job per look under a single catalogueId, tagged source=api_catalog with the calling apiKeyId', async () => {
    await setCredits(1000);
    // Distinct pose+background pairs: createJob rejects duplicate combinations,
    // since regenerating the same look twice is pure duplicate spend.
    const looks = [
      { pose: 'front-standing', background: 'studio-white' },
      { pose: 'side-profile', background: 'studio-white' },
    ];
    const res = await postGenerate(generateBody({ looks }));
    const body = (await res.json()) as {
      catalogueId: string;
      jobs: { jobId: string; pose: string; background: string }[];
    };
    expect(res.status, JSON.stringify(body)).toBe(202);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0].pose).toBe('front-standing');

    const rows = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.catalogueId, body.catalogueId));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      // Both are required for /v1/dev/jobs/:id and /v1/dev/catalogues/:id to find the
      // job at all — createJob defaults to source 'catalog' with no apiKeyId.
      expect(r.source).toBe(JOB_SOURCE.API_CATALOG);
      expect(r.apiKeyId).toBeTruthy();
      expect(r.userId).toBe(userId);
    }
  });

  it('makes generated jobs readable through the existing per-job dev endpoint', async () => {
    await setCredits(1000);
    const res = await postGenerate(generateBody());
    expect(res.status).toBe(202);
    const { jobs } = (await res.json()) as { jobs: { jobId: string }[] };

    const jobRes = await fetch(`${base}/v1/dev/jobs/${jobs[0].jobId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(jobRes.status).toBe(200);
    expect(((await jobRes.json()) as { status: string }).status).toBe('QUEUED');
  });

  describe('own-photo lowerGarment/thirdGarment uploads (composite garment types)', () => {
    it('rejects a requiresLowerUpload garmentType with 400 when lowerGarment is missing, and charges nothing', async () => {
      await setCredits(1000);
      const res = await postGenerate(generateBody({ garmentType: 'kurta-pyjama-test' }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.message).toContain('lowerGarment');

      const [credits] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(credits.balance).toBe(1000);
    });

    it('accepts lowerGarment as base64 JSON and stores it as job_inputs.lowerGarmentKey', async () => {
      await setCredits(1000);
      const res = await postGenerate(
        generateBody({
          garmentType: 'kurta-pyjama-test',
          looks: [{ pose: 'full-body-with-lower', background: 'studio-white' }],
          lowerGarment: jpegBytes().toString('base64'),
        }),
      );
      const body = (await res.json()) as { jobs: { jobId: string }[] };
      expect(res.status, JSON.stringify(body)).toBe(202);

      const [inputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, body.jobs[0].jobId));
      expect(inputs?.lowerGarmentKey).toBeTruthy();
      expect(inputs?.garmentTypeId).toBe(compositeGarmentTypeId);
    });

    it('accepts lowerGarment via multipart/form-data alongside garment', async () => {
      await setCredits(1000);
      const fd = new FormData();
      fd.set('gender', 'women');
      fd.set('face', 'women-model-a');
      fd.set('garmentType', 'kurta-pyjama-test');
      fd.set(
        'looks',
        JSON.stringify([{ pose: 'full-body-with-lower', background: 'studio-white' }]),
      );
      fd.set('aspectRatio', '3:4');
      fd.set('resolution', '2K');
      fd.set('garment', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'garment.jpg');
      fd.set('lowerGarment', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'lower.jpg');

      const res = await fetch(`${base}/v1/dev/catalog/generate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: fd,
      });
      const body = (await res.json()) as { jobs: { jobId: string }[] };
      expect(res.status, JSON.stringify(body)).toBe(202);

      const [inputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, body.jobs[0].jobId));
      expect(inputs?.lowerGarmentKey).toBeTruthy();
    });

    it('leaves lowerGarmentKey null for a garmentType that does not require it', async () => {
      await setCredits(1000);
      const res = await postGenerate(generateBody({ garmentType: 'dress' }));
      const body = (await res.json()) as { jobs: { jobId: string }[] };
      expect(res.status, JSON.stringify(body)).toBe(202);

      const [inputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, body.jobs[0].jobId));
      expect(inputs?.lowerGarmentKey).toBeNull();
    });
  });
});

describe('GET /v1/dev/catalogues/:id', () => {
  it('returns every job of the catalogue in one call', async () => {
    await setCredits(1000);
    const looks = [
      { pose: 'front-standing', background: 'studio-white' },
      { pose: 'side-profile', background: 'studio-white' },
      { pose: 'front-standing', background: 'studio-grey' },
    ];
    const gen = await postGenerate(generateBody({ looks }));
    expect(gen.status).toBe(202);
    const { catalogueId } = (await gen.json()) as { catalogueId: string };

    const res = await fetch(`${base}/v1/dev/catalogues/${catalogueId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      catalogueId: string;
      jobs: { jobId: string; status: string }[];
    };
    expect(body.catalogueId).toBe(catalogueId);
    expect(body.jobs).toHaveLength(3);
    expect(body.jobs.every((j) => j.status === 'QUEUED')).toBe(true);
  });

  it("404s on another merchant's catalogue so ids are not enumerable", async () => {
    await setCredits(1000);
    const gen = await postGenerate(generateBody());
    const { catalogueId } = (await gen.json()) as { catalogueId: string };

    const other = await createTestMerchant(app, { balance: 10 });
    const { key: otherKey } = await createTestApiKey(app, other.merchantId);

    const res = await fetch(`${base}/v1/dev/catalogues/${catalogueId}`, {
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.status).toBe(404);
  });

  it('404s on an unknown catalogueId', async () => {
    const res = await fetch(`${base}/v1/dev/catalogues/00000000-0000-0000-0000-000000000000`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(404);
  });
});
