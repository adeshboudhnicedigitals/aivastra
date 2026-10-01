import { Script } from 'node:vm';
import { schema } from '@aivastra/db';
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Thumbnails on the /results webtool: the grid must serve small images while
// the lightbox/download keep pointing at the full object.
//
// - Output column: stored job_outputs.thumbnailKey when present, otherwise the
//   on-demand /results/:id/thumb/output endpoint (which resizes resultKey).
// - Garment/person inputs have no stored thumbnail, so they always go through
//   the on-demand endpoint for the grid, with the presigned full object kept
//   for lightbox/download.
describe('/results thumbnails', () => {
  let c: Containers;
  let app: TestApp;
  let nextTestClient = 1;
  let cookie: string;
  let bigJpeg: Buffer;
  let smallJpeg: Buffer;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    // Large enough that a 256px thumbnail is observably smaller.
    bigJpeg = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 30, g: 120, b: 200 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    // Distinct fixture content stored under thumbnailKey — lets tests below
    // prove the lightbox/bundle bytes came from r2Key (bigJpeg), not a
    // regression back to serving the admin asset's thumbnailKey (smallJpeg).
    smallJpeg = await sharp({
      create: { width: 40, height: 50, channels: 3, background: { r: 200, g: 20, b: 20 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const password = 'password123';
    const passwordHash = await hashPassword(password);
    const [admin] = await app.db
      .insert(schema.users)
      .values({
        email: 'results-thumb-admin@x.com',
        passwordHash,
        displayName: 'Results Thumb Admin',
        emailVerified: true,
      })
      .returning();
    await app.db.insert(schema.adminUsers).values({
      userId: admin.id,
      role: 'ADMIN',
      status: 'active',
      passwordHash,
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/results/login',
      remoteAddress: `127.0.0.${nextTestClient++}`,
      payload: { email: 'results-thumb-admin@x.com', password },
    });
    const setCookie = loginRes.cookies.find((ck) => ck.name === 'results_access_token');
    cookie = `results_access_token=${setCookie?.value}`;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedJob(opts: {
    userEmail: string;
    upperGarment?: boolean;
    customerPhoto?: boolean;
    poseAsset?: boolean;
    background?: boolean;
    shoeCatalog?: boolean;
    result?: boolean;
    resultThumb?: boolean;
    videoResult?: boolean;
  }) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: opts.userEmail, emailVerified: true })
      .returning();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'COMPLETED',
        creditsCharged: 5,
        source: 'tryon',
        customerPhotoKey: opts.customerPhoto ? `test/${user.id}/customer.jpg` : null,
      })
      .returning();
    const jobId = job.id as string;

    const upperGarmentKey = opts.upperGarment ? `test/${jobId}/upper.jpg` : null;
    if (upperGarmentKey) await app.storage.putObject(upperGarmentKey, bigJpeg, 'image/jpeg');
    if (opts.customerPhoto)
      await app.storage.putObject(`test/${user.id}/customer.jpg`, bigJpeg, 'image/jpeg');

    let poseId: string | null = null;
    if (opts.poseAsset) {
      const fullKey = `test/${jobId}/pose.jpg`;
      const thumbKey = `test/${jobId}/pose.thumb.jpg`;
      await app.storage.putObject(fullKey, bigJpeg, 'image/jpeg');
      await app.storage.putObject(thumbKey, smallJpeg, 'image/jpeg');
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({ label: 'thumb-test-pose', r2Key: fullKey, thumbnailKey: thumbKey })
        .returning();
      poseId = pose.id as string;
    }

    let backgroundId: string | null = null;
    if (opts.background) {
      const fullKey = `test/${jobId}/bg.jpg`;
      const thumbKey = `test/${jobId}/bg.thumb.jpg`;
      await app.storage.putObject(fullKey, bigJpeg, 'image/jpeg');
      await app.storage.putObject(thumbKey, smallJpeg, 'image/jpeg');
      const [bg] = await app.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'thumb-test-bg', r2Key: fullKey, thumbnailKey: thumbKey })
        .returning();
      backgroundId = bg.id as string;
    }

    let shoeCatalogId: string | null = null;
    if (opts.shoeCatalog) {
      await app.storage.putObject(`test/${jobId}/shoe.jpg`, bigJpeg, 'image/jpeg');
      await app.storage.putObject(`test/${jobId}/shoe.thumb.jpg`, smallJpeg, 'image/jpeg');
      const [shoe] = await app.db
        .insert(schema.catalogItems)
        .values({
          type: 'shoe',
          label: 'thumb-test-shoe',
          r2Key: `test/${jobId}/shoe.jpg`,
          thumbnailKey: `test/${jobId}/shoe.thumb.jpg`,
        })
        .returning();
      shoeCatalogId = shoe.id as string;
    }

    await app.db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey,
      poseId,
      backgroundId,
      shoeCatalogId,
    });

    const resultKey = opts.videoResult
      ? `test/${jobId}/result.mp4`
      : opts.result
        ? `test/${jobId}/result.png`
        : null;
    const thumbnailKey = opts.resultThumb ? `test/${jobId}/result.thumb.jpg` : null;
    if (resultKey)
      await app.storage.putObject(
        resultKey,
        opts.videoResult ? Buffer.from('fake-mp4-bytes') : bigJpeg,
        opts.videoResult ? 'video/mp4' : 'image/png',
      );
    if (thumbnailKey) await app.storage.putObject(thumbnailKey, bigJpeg, 'image/jpeg');
    if (resultKey || thumbnailKey) {
      await app.db.insert(schema.jobOutputs).values({ jobId, resultKey, thumbnailKey });
    }

    return { jobId, upperGarmentKey, resultKey, thumbnailKey };
  }

  async function fetchItem(jobId: string) {
    const res = await app.inject({
      method: 'GET',
      url: '/results/data?status=all&pageSize=100',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === jobId);
    expect(item).toBeTruthy();
    return item as Record<string, unknown>;
  }

  it('uses the stored output thumbnail for the grid and keeps the full object for lightbox', async () => {
    const { jobId } = await seedJob({
      userEmail: 'thumb-stored@x.com',
      result: true,
      resultThumb: true,
    });
    const item = await fetchItem(jobId);
    expect(item.outputUrl).toContain('result.png');
    expect(item.outputThumbUrl).toContain('result.thumb.jpg');
    expect(item.outputThumbUrl).not.toBe(item.outputUrl);
  });

  it('falls back to the on-demand endpoint when no stored output thumbnail exists', async () => {
    const { jobId } = await seedJob({ userEmail: 'thumb-fallback@x.com', result: true });
    const item = await fetchItem(jobId);
    expect(item.outputUrl).toContain('result.png');
    expect(item.outputThumbUrl).toBe(`/results/${jobId}/thumb/output`);
  });

  it('points garment grid cells at the on-demand endpoint and keeps full URLs', async () => {
    const { jobId } = await seedJob({
      userEmail: 'thumb-garment@x.com',
      upperGarment: true,
      result: true,
      resultThumb: true,
    });
    const item = await fetchItem(jobId);
    const garments = item.garments as { url: string; thumbUrl: string; label: string | null }[];
    expect(garments.length).toBe(1);
    expect(garments[0].thumbUrl).toBe(`/results/${jobId}/thumb/garment-upper`);
    expect(garments[0].url).toContain('upper.jpg');
  });

  it('serves person photos through the endpoint without shadowing a pose asset', async () => {
    // No pose asset: person photo is the pose cell, thumb via endpoint.
    const noPose = await seedJob({ userEmail: 'thumb-person@x.com', customerPhoto: true });
    const personItem = await fetchItem(noPose.jobId);
    expect(personItem.poseTag).toBe('person');
    expect(personItem.personThumbUrl).toBe(`/results/${noPose.jobId}/thumb/person`);
    expect(personItem.poseFullUrl).toContain('customer.jpg');

    // Pose asset present: pose thumbnail stays authoritative, person thumb suppressed.
    const withPose = await seedJob({
      userEmail: 'thumb-pose-wins@x.com',
      customerPhoto: true,
      poseAsset: true,
    });
    const poseItem = await fetchItem(withPose.jobId);
    expect(poseItem.poseTag).toBeNull();
    expect(poseItem.personThumbUrl).toBeNull();
    expect(poseItem.poseUrl).toContain('pose.thumb.jpg');
    // Lightbox/download must follow the pose asset's own full r2Key, not its
    // thumbnailKey — the grid cell above and the lightbox target must differ.
    expect(poseItem.poseFullUrl).toContain('/pose.jpg');
    expect(poseItem.poseFullUrl).not.toContain('pose.thumb.jpg');
  });

  it('keeps the full-res object for background/shoe lightbox and download, not the thumbnail', async () => {
    const { jobId } = await seedJob({
      userEmail: 'thumb-bg-shoe@x.com',
      background: true,
      shoeCatalog: true,
    });
    const item = await fetchItem(jobId);
    expect(item.backgroundUrl).toContain('bg.thumb.jpg');
    expect(item.backgroundFullUrl).toContain('/bg.jpg');
    expect(item.backgroundFullUrl).not.toContain('bg.thumb.jpg');
    expect(item.shoeUrl).toContain('shoe.thumb.jpg');
    expect(item.shoeFullUrl).toContain('/shoe.jpg');
    expect(item.shoeFullUrl).not.toContain('shoe.thumb.jpg');
  });

  it('bundle download zips the full-res pose/background/shoe objects, not their thumbnails', async () => {
    const { jobId } = await seedJob({
      userEmail: 'thumb-bundle-full@x.com',
      poseAsset: true,
      background: true,
      shoeCatalog: true,
    });
    await app.db
      .update(schema.jobs)
      .set({ flagged: true, flagReason: 'texture_issue', flaggedAt: new Date() })
      .where(eq(schema.jobs.id, jobId));

    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/bundle`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const zip = new AdmZip(res.rawPayload);
    // Thumb and full fixtures are deliberately different images (bigJpeg vs.
    // smallJpeg) — comparing bytes, not just entry presence, is what catches a
    // regression back to zipping thumbnailKey instead of r2Key.
    for (const name of ['inputs/pose.jpg', 'inputs/background.jpg', 'inputs/shoe.jpg']) {
      const entry = zip.getEntry(name);
      expect(entry, `missing ${name}`).toBeTruthy();
      const data = entry!.getData();
      expect(data.equals(bigJpeg), `${name} should be the full-res object`).toBe(true);
      expect(data.equals(smallJpeg), `${name} should not be the thumbnail`).toBe(false);
    }
  });

  it('resizes garment inputs to a small JPEG', async () => {
    const { jobId } = await seedJob({ userEmail: 'thumb-resize@x.com', upperGarment: true });
    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/garment-upper`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cache-control']).toContain('immutable');
    const body = res.rawPayload as unknown as Buffer;
    expect(body.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(body.length).toBeLessThan(bigJpeg.length);
    const meta = await sharp(body).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(256);
  });

  it('redirects output thumb requests to the stored thumbnail when present', async () => {
    const { jobId } = await seedJob({
      userEmail: 'thumb-redir@x.com',
      result: true,
      resultThumb: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/output`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('result.thumb.jpg');
  });

  it('redirects video outputs to the raw file instead of resizing', async () => {
    const { jobId } = await seedJob({ userEmail: 'thumb-video@x.com', videoResult: true });
    const item = await fetchItem(jobId);
    expect(item.outputThumbUrl).toBe(`/results/${jobId}/thumb/output`);
    const res = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/output`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('result.mp4');
  });

  it('serves syntactically valid app.js (a slip here blanks the whole page)', async () => {
    const res = await app.inject({ method: 'GET', url: '/results/app.js?v=test' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    // Compiles without executing — guards the template-literal JS after edits.
    expect(() => new Script(res.body)).not.toThrow();
    // Thumbnail wiring survived server-side rendering (endpoint paths themselves
    // arrive via /results/data, so the script only names the data fields).
    expect(res.body).toContain('outputThumbUrl');
    expect(res.body).toContain('personThumbUrl');
    expect(res.body).toContain('poseFullUrl');
  });

  it('returns 404 for unknown jobs, empty slots, and rejects bad slots/anonymous callers', async () => {
    const { jobId } = await seedJob({ userEmail: 'thumb-404@x.com', upperGarment: true });

    const missingSlot = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/garment-lower`,
      headers: { cookie },
    });
    expect(missingSlot.statusCode).toBe(404);

    const unknownJob = await app.inject({
      method: 'GET',
      url: '/results/00000000-0000-4000-8000-000000000000/thumb/garment-upper',
      headers: { cookie },
    });
    expect(unknownJob.statusCode).toBe(404);

    const badSlot = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/not-a-slot`,
      headers: { cookie },
    });
    expect(badSlot.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'GET',
      url: `/results/${jobId}/thumb/garment-upper`,
    });
    expect(anon.statusCode).toBe(401);
  });
});
